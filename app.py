import os
import sqlite3
import requests
from flask import Flask, render_template, request, jsonify
import json
from werkzeug.utils import secure_filename
import webbrowser
from threading import Timer
import sys
#import signal

# 1. Determina dove si trova l'eseguibile (o il file app.py)
if getattr(sys, 'frozen', False):
    # Se è un eseguibile, usa la cartella in cui hai cliccato il file .exe / binario
    work_dir = os.path.dirname(sys.executable)
    # Cartella temporanea dove PyInstaller mette HTML e CSS
    base_dir = sys._MEIPASS 
else:
    # Se lo avvii con 'python3 app.py', usa la cartella del progetto
    work_dir = os.path.abspath(os.path.dirname(__file__))
    base_dir = work_dir

# 2. Inizializza Flask (usa base_dir per HTML/CSS)
app = Flask(__name__, 
            template_folder=os.path.join(base_dir, 'templates'),
            static_folder=os.path.join(base_dir, 'static'))

# 3. Percorsi sicuri per i dati dell'utente (usa work_dir per salvarli vicino all'exe)
os.makedirs(os.path.join(work_dir, 'data'), exist_ok=True)
DB_PATH = os.path.join(work_dir, 'data', 'collection.db')

BANLIST_DIR = os.path.join(work_dir, 'banlist')
os.makedirs(BANLIST_DIR, exist_ok=True)

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY,
            name TEXT,
            image_url TEXT,
            owned_qty INTEGER DEFAULT 0,
            wishlist_qty INTEGER DEFAULT 0
        )
    ''')

    # NUOVE TABELLE PER IL DECK BUILDER
    c.execute('''
        CREATE TABLE IF NOT EXISTS decks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS deck_cards (
            deck_id INTEGER,
            card_id INTEGER,
            quantity INTEGER DEFAULT 1,
            FOREIGN KEY(deck_id) REFERENCES decks(id),
            FOREIGN KEY(card_id) REFERENCES cards(id),
            PRIMARY KEY (deck_id, card_id)
        )
    ''')
    
    # Aggiungo dinamicamente le nuove colonne se non esistono (aggiornamento DB sicuro)
    new_columns = [
        ('card_type', 'TEXT'), ('card_subtype', 'TEXT'), 
        ('attribute', 'TEXT'), ('race', 'TEXT'), ('level', 'INTEGER')
    ]
    for col_name, col_type in new_columns:
        try:
            c.execute(f'ALTER TABLE cards ADD COLUMN {col_name} {col_type}')
        except sqlite3.OperationalError:
            pass # La colonna esiste già

    # NUOVA TABELLA PER IL DATABASE OFFLINE VELOCE
    c.execute('''
        CREATE TABLE IF NOT EXISTS global_cards (
            id INTEGER PRIMARY KEY,
            name TEXT,
            image_url TEXT,
            card_type TEXT,
            card_subtype TEXT,
            attribute TEXT,
            race TEXT,
            level TEXT
        )
    ''')

    # Aggiornamento sicuro: Aggiunge la colonna banlist_info se non esiste
    try:
        c.execute('ALTER TABLE global_cards ADD COLUMN banlist_info TEXT')
    except sqlite3.OperationalError:
        pass
        
    try:
        c.execute('ALTER TABLE cards ADD COLUMN banlist_info TEXT')
    except sqlite3.OperationalError:
        pass
            
    conn.commit()
    conn.close()

init_db()

# Funzione helper per estrarre i dati in modo pulito dall'API di YGOPRODeck
def extract_card_info(c):
    raw_type = c.get('type', '')
    if 'Monster' in raw_type:
        ctype = 'Mostro'
        subtype = raw_type.replace(' Monster', '')
    elif 'Spell' in raw_type:
        ctype = 'Magia'
        subtype = c.get('race', '') # Equip, Field, ecc..
    elif 'Trap' in raw_type:
        ctype = 'Trappola'
        subtype = c.get('race', '')
    else:
        ctype = 'Altro'
        subtype = ''
        
    return {
        'id': c['id'],
        'name': c['name'],
        'image_url': c['card_images'][0]['image_url_small'],
        'card_type': ctype,
        'card_subtype': subtype,
        'attribute': c.get('attribute', ''),
        'race': c.get('race', '') if ctype == 'Mostro' else '',
        'level': c.get('level', c.get('linkval', ''))
    }

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/sync_db', methods=['POST'])
def sync_database():
    # AGGIUNTO &misc=yes per ottenere le date di rilascio ufficiali!
    res_en = requests.get("https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes")
    res_it = requests.get("https://db.ygoprodeck.com/api/v7/cardinfo.php?language=it")
    
    if res_en.status_code != 200:
        return jsonify({"success": False, "error": "API irraggiungibile"})

    data_en = res_en.json().get('data', [])
    data_it = res_it.json().get('data', []) if res_it.status_code == 200 else []
    
    it_names = {item['id']: item['name'] for item in data_it}

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute('DROP TABLE IF EXISTS global_cards')
    c.execute('''
        CREATE TABLE global_cards (
            id INTEGER PRIMARY KEY,
            name TEXT,
            name_it TEXT,
            image_url TEXT,
            card_type TEXT,
            card_subtype TEXT,
            attribute TEXT,
            race TEXT,
            level TEXT,
            banlist_info TEXT,
            tcg_date TEXT 
        )
    ''')
    
    cards_to_insert = []
    for item in data_en:
        cid = item['id']
        name_en = item['name']
        name_it = it_names.get(cid, name_en) 
        
        image_url = item['card_images'][0]['image_url'] if 'card_images' in item else ''
        ctype = item.get('type', '')
        csubtype = item.get('frameType', '') 
        attr = item.get('attribute', '')
        race = item.get('race', '')
        level = str(item.get('level', ''))
        
        ban_info = item.get('banlist_info') or {}
        banlist_data = json.dumps(ban_info)
        
        # Estrae la data di uscita (se non esiste, mette 2099 così viene bloccata nei formati storici)
        misc_info = item.get('misc_info', [{}])[0]
        tcg_date = misc_info.get('tcg_date', '2099-01-01')
        
        cards_to_insert.append((cid, name_en, name_it, image_url, ctype, csubtype, attr, race, level, banlist_data, tcg_date))
        
    c.executemany('''INSERT INTO global_cards 
                     (id, name, name_it, image_url, card_type, card_subtype, attribute, race, level, banlist_info, tcg_date) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', cards_to_insert)
                     
    # Assicurati di aggiungere la colonna tcg_date alla tabella 'cards' nel tuo init_db() se non l'hai fatto,
    # ed esegui la query di UPDATE come fatto in precedenza, includendo tcg_date.
    try:
        c.execute('ALTER TABLE cards ADD COLUMN tcg_date TEXT')
    except sqlite3.OperationalError:
        pass

    c.execute('''
        UPDATE cards 
        SET 
            name = (SELECT name_it FROM global_cards WHERE global_cards.id = cards.id),
            image_url = (SELECT image_url FROM global_cards WHERE global_cards.id = cards.id),
            card_type = (SELECT card_type FROM global_cards WHERE global_cards.id = cards.id),
            card_subtype = (SELECT card_subtype FROM global_cards WHERE global_cards.id = cards.id),
            attribute = (SELECT attribute FROM global_cards WHERE global_cards.id = cards.id),
            race = (SELECT race FROM global_cards WHERE global_cards.id = cards.id),
            level = (SELECT level FROM global_cards WHERE global_cards.id = cards.id),
            banlist_info = (SELECT banlist_info FROM global_cards WHERE global_cards.id = cards.id),
            tcg_date = (SELECT tcg_date FROM global_cards WHERE global_cards.id = cards.id)
        WHERE id IN (SELECT id FROM global_cards)
    ''')
    
    conn.commit()
    conn.close()
    return jsonify({"success": True, "count": len(cards_to_insert)})

@app.route('/api/search', methods=['GET'])
def search_cards():
    query = request.args.get('q', '').lower()
    if not query:
        return jsonify([])
        
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Cerca la stringa SIA nel nome inglese SIA in quello italiano!
    search_pattern = f"%{query}%"
    c.execute('''
        SELECT * FROM global_cards 
        WHERE LOWER(name) LIKE ? OR LOWER(name_it) LIKE ? 
        LIMIT 100
    ''', (search_pattern, search_pattern))
    
    results = [dict(row) for row in c.fetchall()]
    
    # Sostituisce il nome standard con quello italiano prima di inviarlo all'interfaccia
    for r in results:
        r['name'] = r['name_it']
        
    conn.close()
    return jsonify(results)

@app.route('/api/update', methods=['POST'])
def update_card():
    data = request.json
    card_id = data['id']
    name = data['name']
    img_url = data['image_url']
    update_type = data['update_type']
    action = data['action']

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute('SELECT owned_qty, wishlist_qty FROM cards WHERE id = ?', (card_id,))
    row = c.fetchone()
    
    if not row:
        c.execute('''INSERT INTO cards (id, name, image_url, card_type, card_subtype, attribute, race, level) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)''', 
                  (card_id, name, img_url, data.get('card_type',''), data.get('card_subtype',''), 
                   data.get('attribute',''), data.get('race',''), data.get('level','')))
        owned, wish = 0, 0
    else:
        owned, wish = row

    if update_type == 'owned':
        owned = owned + 1 if action == 'add' else max(0, owned - 1)
    elif update_type == 'wishlist':
        wish = wish + 1 if action == 'add' else max(0, wish - 1)

    c.execute('UPDATE cards SET owned_qty = ?, wishlist_qty = ? WHERE id = ?', (owned, wish, card_id))
    
    # FIX IMPORTANTE: Elimina la carta solo se ha q.tà 0 e NON è in nessun mazzo
    c.execute('''
        DELETE FROM cards 
        WHERE owned_qty = 0 AND wishlist_qty = 0 
        AND id NOT IN (SELECT card_id FROM deck_cards)
    ''')
    
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/cards')
def get_cards():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM cards')
    cards = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify(cards)

# ==========================================
# ENDPOINT API PER IL DECK BUILDER
# ==========================================

# Aggiornamento automatico DB per supportare il Side Deck
def upgrade_db_for_side_deck():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    try:
        c.execute('ALTER TABLE deck_cards ADD COLUMN side_qty INTEGER DEFAULT 0')
        conn.commit()
    except sqlite3.OperationalError:
        pass # La colonna esiste già
    conn.close()

upgrade_db_for_side_deck()

@app.route('/api/decks', methods=['GET', 'POST'])
def manage_decks():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    if request.method == 'POST':
        name = request.json.get('name')
        c.execute('INSERT INTO decks (name) VALUES (?)', (name,))
        conn.commit()
        deck_id = c.lastrowid
        conn.close()
        return jsonify({'id': deck_id, 'name': name})
    
    c.execute('SELECT * FROM decks')
    decks = [{'id': row[0], 'name': row[1]} for row in c.fetchall()]
    conn.close()
    return jsonify(decks)

@app.route('/api/decks/<int:deck_id>', methods=['GET'])
def get_deck(deck_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    c.execute('''
        SELECT c.*, dc.quantity as deck_qty, dc.side_qty
        FROM deck_cards dc
        JOIN cards c ON dc.card_id = c.id
        WHERE dc.deck_id = ?
    ''', (deck_id,))
    
    cards = [dict(row) for row in c.fetchall()]
        
    conn.close()
    return jsonify(cards)

@app.route('/api/decks/<int:deck_id>/add', methods=['POST'])
def add_to_deck(deck_id):
    data = request.json
    card_id = data.get('card_id')
    zone = data.get('zone', 'main')
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Estrae banlist_info E tcg_date dal database globale per la carta richiesta
    c.execute('SELECT banlist_info, tcg_date FROM global_cards WHERE id = ?', (card_id,))
    global_row = c.fetchone()
    
    banlist_data = global_row[0] if global_row and global_row[0] else "{}"
    tcg_date = global_row[1] if global_row and global_row[1] else "2099-01-01"

    # Inserisce o aggiorna la carta nella tabella 'cards' (collezione locale) con le info storiche
    c.execute('SELECT id FROM cards WHERE id = ?', (card_id,))
    if not c.fetchone():
        c.execute('''INSERT INTO cards (id, name, image_url, card_type, card_subtype, attribute, race, level, banlist_info, tcg_date) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', 
                  (card_id, data.get('name',''), data.get('image_url',''), 
                   data.get('card_type',''), data.get('card_subtype',''), 
                   data.get('attribute',''), data.get('race',''), data.get('level',''), banlist_data, tcg_date))
    else:
        c.execute('''UPDATE cards 
                     SET name = ?, image_url = ?, card_type = ?, card_subtype = ?, attribute = ?, race = ?, level = ?, banlist_info = ?, tcg_date = ?
                     WHERE id = ?''',
                  (data.get('name',''), data.get('image_url',''), 
                   data.get('card_type',''), data.get('card_subtype',''), 
                   data.get('attribute',''), data.get('race',''), data.get('level',''), banlist_data, tcg_date, card_id))

    # Gestisce l'aggiunta al mazzo specifico (main, extra o side)
    c.execute('SELECT quantity, side_qty FROM deck_cards WHERE deck_id = ? AND card_id = ?', (deck_id, card_id))
    row = c.fetchone()
    
    if row:
        if zone == 'side':
            c.execute('UPDATE deck_cards SET side_qty = side_qty + 1 WHERE deck_id = ? AND card_id = ?', (deck_id, card_id))
        else:
            c.execute('UPDATE deck_cards SET quantity = quantity + 1 WHERE deck_id = ? AND card_id = ?', (deck_id, card_id))
    else:
        if zone == 'side':
            c.execute('INSERT INTO deck_cards (deck_id, card_id, quantity, side_qty) VALUES (?, ?, 0, 1)', (deck_id, card_id))
        else:
            c.execute('INSERT INTO deck_cards (deck_id, card_id, quantity, side_qty) VALUES (?, ?, 1, 0)', (deck_id, card_id))
            
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/decks/<int:deck_id>/remove', methods=['POST'])
def remove_from_deck(deck_id):
    card_id = request.json.get('card_id')
    zone = request.json.get('zone', 'main')
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT quantity, side_qty FROM deck_cards WHERE deck_id = ? AND card_id = ?', (deck_id, card_id))
    row = c.fetchone()
    
    if row:
        qty, side_qty = row
        if zone == 'side' and side_qty > 0:
            side_qty -= 1
        elif zone == 'main' and qty > 0:
            qty -= 1
            
        if qty == 0 and side_qty == 0:
            c.execute('DELETE FROM deck_cards WHERE deck_id = ? AND card_id = ?', (deck_id, card_id))
        else:
            c.execute('UPDATE deck_cards SET quantity = ?, side_qty = ? WHERE deck_id = ? AND card_id = ?', (qty, side_qty, deck_id, card_id))
            
    # Pulizia DB: se la rimozione ha lasciato la carta orfana, eliminala
    c.execute('''
        DELETE FROM cards 
        WHERE owned_qty = 0 AND wishlist_qty = 0 
        AND id NOT IN (SELECT card_id FROM deck_cards)
    ''')
            
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/decks/<int:deck_id>', methods=['DELETE'])
def delete_deck(deck_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # 1. Rimuove tutte le carte associate al mazzo
    c.execute('DELETE FROM deck_cards WHERE deck_id = ?', (deck_id,))
    # 2. Rimuove il mazzo stesso
    c.execute('DELETE FROM decks WHERE id = ?', (deck_id,))
    
    # 3. Pulizia DB: se l'eliminazione del mazzo ha lasciato carte orfane, eliminale
    c.execute('''
        DELETE FROM cards 
        WHERE owned_qty = 0 AND wishlist_qty = 0 
        AND id NOT IN (SELECT card_id FROM deck_cards)
    ''')
    
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/decks/import', methods=['POST'])
def import_deck_ydk():
    data = request.json
    deck_name = data['name']
    cards_list = data['cards'] # Lista di dizionari: {'id': 123, 'zone': 'main'/'extra'/'side'}
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # 1. Crea il nuovo mazzo
    c.execute('INSERT INTO decks (name) VALUES (?)', (deck_name,))
    deck_id = c.lastrowid
    
    # 2. Raggruppa le quantità per evitare doppioni
    deck_counts = {}
    for card in cards_list:
        cid = int(card['id'])
        zone = card['zone']
        if cid not in deck_counts:
            deck_counts[cid] = {'main': 0, 'side': 0}
            
        if zone == 'side':
            deck_counts[cid]['side'] += 1
        else:
            deck_counts[cid]['main'] += 1
            
    # 3. Ottieni le info delle carte da YGOPRODeck per quelle che non hai nel DB
    missing_ids = []
    for cid in deck_counts.keys():
        c.execute('SELECT id FROM cards WHERE id = ?', (cid,))
        if not c.fetchone():
            missing_ids.append(str(cid))
            
    if missing_ids:
        # Chiamata API cumulativa (fino a centinaia di ID in una sola richiesta)
        api_url = f"https://db.ygoprodeck.com/api/v7/cardinfo.php?id={','.join(missing_ids)}"
        response = requests.get(api_url)
        if response.status_code == 200:
            api_data = response.json().get('data', [])
            for item in api_data:
                c.execute('''INSERT INTO cards (id, name, image_url, card_type, card_subtype, attribute, race, level) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)''', 
                          (item['id'], item['name'], item['card_images'][0]['image_url'], 
                           item.get('type', ''), item.get('race', ''), # YGOPro usa 'type' al posto di 'card_type'
                           item.get('attribute', ''), item.get('race', ''), item.get('level', '')))
    
    # 4. Inserisci le carte nel mazzo
    for cid, counts in deck_counts.items():
        c.execute('INSERT INTO deck_cards (deck_id, card_id, quantity, side_qty) VALUES (?, ?, ?, ?)', 
                  (deck_id, cid, counts['main'], counts['side']))
        
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'deck_id': deck_id})


@app.route('/api/banlists', methods=['GET'])
def get_banlists():
    """Scansiona la cartella banlist/ e restituisce la lista dei file .conf presenti"""
    if not os.path.exists(BANLIST_DIR):
        return jsonify([])
    files = [f for f in os.listdir(BANLIST_DIR) if f.endswith('.conf')]
    return jsonify(files)

@app.route('/api/banlists/<filename>', methods=['GET'])
def get_banlist_content(filename):
    """Legge e restituisce il testo di uno specifico file .conf"""
    safe_name = secure_filename(filename)
    file_path = os.path.join(BANLIST_DIR, safe_name)
    if not os.path.exists(file_path):
        return jsonify({'success': False, 'error': 'File non trovato'}), 404
        
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    return jsonify({'success': True, 'content': content})

@app.route('/api/banlists/upload', methods=['POST'])
def upload_banlist():
    """Salva un nuovo file .conf caricato dall'interfaccia direttamente nella cartella banlist/"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'Nessun file trovato'})
    file = request.files['file']
    if file.filename == '' or not file.filename.endswith('.conf'):
        return jsonify({'success': False, 'error': 'File non valido'})
        
    filename = secure_filename(file.filename)
    file_path = os.path.join(BANLIST_DIR, filename)
    file.save(file_path)
    return jsonify({'success': True, 'filename': filename})

@app.route('/api/banlists/<filename>', methods=['DELETE'])
def delete_banlist(filename):
    """Elimina un file .conf dalla cartella banlist/ del server"""
    safe_name = secure_filename(filename)
    file_path = os.path.join(BANLIST_DIR, safe_name)
    
    if os.path.exists(file_path):
        os.remove(file_path)
        return jsonify({'success': True})
    
    return jsonify({'success': False, 'error': 'File non trovato'}), 404

def open_browser():
    """Apre automaticamente il browser predefinito all'indirizzo dell'app"""
    webbrowser.open_new('http://127.0.0.1:5000/')

#@app.route('/api/shutdown', methods=['POST'])
#def shutdown_server():
#    """Arresta il server Flask in modo pulito e nativo."""
#    def kill_server():
#        # Invia il segnale di chiusura (equivalente a premere CTRL+C nel terminale)
#        os.kill(os.getpid(), signal.SIGINT)
#        
#    # Aspetta mezzo secondo prima di "uccidere" il server, 
#    # così il browser fa in tempo a ricevere il messaggio di successo.
#    Timer(0.5, kill_server).start()
#    
#    return jsonify({'success': True, 'message': 'Server arrestato'})

if __name__ == '__main__':
    # Apre il browser 1.5 secondi dopo l'avvio del server
    Timer(1.0, open_browser).start()
    #app.run(host='127.0.0.1', port=5000, debug=False)
    app.run(host='0.0.0.0', port=5000) 
