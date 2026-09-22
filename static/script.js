const DeckBuilder = {
    currentDeckId: null,
    allUserCards: [],
    currentDeckCards: [],
    apiSearchCache: {},
    
    async init() {
        await this.loadDecksDropdown();
        await this.fetchUserCards();
    },

    async fetchUserCards() {
        const res = await fetch('/api/cards');
        const cards = await res.json();
        this.allUserCards = cards.filter(c => c.owned_qty > 0 || c.wishlist_qty > 0);
    },

    async loadDecksDropdown() {
        const res = await fetch('/api/decks');
        const decks = await res.json();
        const select = document.getElementById('dbDeckSelect');
        select.innerHTML = '<option value="">Seleziona un mazzo...</option>';
        decks.forEach(d => {
            select.innerHTML += `<option value="${d.id}">${d.name}</option>`;
        });
        if(this.currentDeckId) select.value = this.currentDeckId;
        await this.loadAvailableBanlists();
    },

    async createNewDeck() {
        const name = prompt("Inserisci il nome del nuovo mazzo:");
        if (!name || name.trim() === "") return;
        
        const res = await fetch('/api/decks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
        });
        const newDeck = await res.json();
        await this.loadDecksDropdown();
        document.getElementById('dbDeckSelect').value = newDeck.id;
        this.loadDeck(newDeck.id);
    },

    sortDeck() {
        this.sortDeckLogic();
        this.renderDeck();
    },

    sortDeckLogic() {
        this.currentDeckCards.sort((a, b) => {
            const getWeight = (type, subtype) => {
                const t = type || '';
                const s = subtype || '';
                if (t === 'Mostro' || t.includes('Monster')) {
                    if (s.includes('Link')) return 70;
                    if (s.includes('Xyz') || s.includes('XYZ')) return 60;
                    if (s.includes('Synchro')) return 50;
                    if (s.includes('Fusion')) return 40;
                    if (s.includes('Ritual')) return 30;
                    if (s.includes('Effect')) return 20;
                    if (s.includes('Normal')) return 10;
                    return 80;
                }
                if (t === 'Magia' || t.includes('Spell')) return 100;
                if (t === 'Trappola' || t.includes('Trap')) return 200;
                return 999;
            };

            const weightA = getWeight(a.card_type, a.card_subtype);
            const weightB = getWeight(b.card_type, b.card_subtype);
            
            if (weightA === weightB) {
                const nameA = a.name || "";
                const nameB = b.name || "";
                return nameA.localeCompare(nameB);
            }
            return weightA - weightB;
        });
    },

    async loadDeck(deckId) {
        this.currentDeckId = deckId;
        if (!deckId) {
            document.getElementById('dbWorkspace').style.display = 'none';
            document.getElementById('dbDeleteDeckBtn').style.display = 'none';
            document.getElementById('dbSortBtn').style.display = 'none';
            document.getElementById('dbExportBtn').style.display = 'none';
            document.getElementById('dbTestDrawBtn').style.display = 'none';
            return;
        }
        document.getElementById('dbWorkspace').style.display = 'flex';
        document.getElementById('dbDeleteDeckBtn').style.display = 'inline-block';
        document.getElementById('dbSortBtn').style.display = 'inline-block';
        document.getElementById('dbExportBtn').style.display = 'inline-block';
        document.getElementById('dbTestDrawBtn').style.display = 'inline-block';
        
        const res = await fetch(`/api/decks/${deckId}`);
        this.currentDeckCards = await res.json();
        
        this.sortDeckLogic(); 
        this.renderDeck();
    },

    async deleteDeck() {
        if (!this.currentDeckId) return;
        
        if (!confirm("Sei sicuro di voler eliminare definitivamente questo mazzo? L'azione è irreversibile.")) {
            return;
        }
        
        await fetch(`/api/decks/${this.currentDeckId}`, {
            method: 'DELETE'
        });
        
        this.currentDeckId = null;
        await this.loadDecksDropdown();
        this.loadDeck("");
    },

    isExtraDeckCard(card) {
        const sub = (card.card_subtype || '').toLowerCase();
        return sub.includes('fusion') || sub.includes('synchro') || sub.includes('xyz') || sub.includes('link');
    },

    isValidMainDeckCard(card) {
        if (this.isExtraDeckCard(card)) return false;
        const type = (card.card_type || '').toLowerCase();
        const sub = (card.card_subtype || '').toLowerCase();
        if (type.includes('token') || sub.includes('token')) return false; 
        return true; 
    },

    async searchApi() {
        const query = document.getElementById('dbSearchInput').value.trim();
        const container = document.getElementById('dbAvailableCards');
        const spinner = document.getElementById('dbLoadingSpinner');
        
        if (query === "") {
            container.innerHTML = '';
            spinner.style.display = 'none';
            return;
        }
        
        container.innerHTML = '';
        spinner.style.display = 'block';
        
        try {
            const res = await fetch(`/api/search?q=${query}`);
            const ObjectCards = await res.json();
            spinner.style.display = 'none';
            
            if (ObjectCards.length === 0) {
                container.innerHTML = '<p class="text-secondary text-center mt-3">Nessuna carta trovata.</p>';
                return;
            }
            
            ObjectCards.forEach(card => {
                this.apiSearchCache[card.id] = card; 
                container.innerHTML += `
                    <div class="col-4 mb-2 text-center position-relative">
                        ${this.getBanlistBadge(card)}
                        <img src="${card.image_url}" class="img-fluid rounded" style="cursor: grab;" 
                             draggable="true" 
                             ondragstart="DeckBuilder.handleDragStart(event, '${card.id}')"
                             onclick="DeckBuilder.inspectCard('${card.id}')"
                             oncontextmenu="DeckBuilder.addCard('${card.id}', event, 'main')"
                             title="Click SX: Ispeziona | Click DX: Aggiungi al Deck | Trascina nel Side">
                    </div>
                `;
            });
        } catch (error) {
            spinner.style.display = 'none';
            container.innerHTML = '<p class="text-danger text-center mt-3">Errore di ricerca</p>';
        }
    },

    renderDeck() {
        const mainZone = document.getElementById('dbMainDeckCards');
        const extraZone = document.getElementById('dbExtraDeckCards');
        const sideZone = document.getElementById('dbSideDeckCards');
        mainZone.innerHTML = ''; extraZone.innerHTML = ''; sideZone.innerHTML = '';

        let mainTotal = 0, mainOwned = 0, mainWish = 0;
        let extraTotal = 0, extraOwned = 0, extraWish = 0;
        let sideTotal = 0;

        this.currentDeckCards.forEach(card => {
            const isExtra = this.isExtraDeckCard(card);
            
            for (let i = 0; i < (card.deck_qty || 0); i++) {
                const currentPhysicalUseIndex = i + (card.side_qty || 0);
                const isMissingPhysically = currentPhysicalUseIndex >= (card.owned_qty || 0);
                
                if (isExtra) {
                    extraTotal++;
                    if (isMissingPhysically) extraWish++; else extraOwned++;
                } else {
                    mainTotal++;
                    if (isMissingPhysically) mainWish++; else mainOwned++;
                }

                const style = isMissingPhysically ? "filter: grayscale(100%); opacity: 0.6; cursor: pointer;" : "cursor: pointer;";
                const cardHTML = `
                    <div class="col-2 mb-2 position-relative">
                        ${this.getBanlistBadge(card)}
                        <img src="${card.image_url}" class="img-fluid rounded" style="${style}"
                             oncontextmenu="DeckBuilder.removeCard('${card.id}', event, 'main')"
                             title="Click DX per rimuovere">
                    </div>
                `;
                
                if (isExtra) extraZone.innerHTML += cardHTML;
                else mainZone.innerHTML += cardHTML;
            }

            for (let i = 0; i < (card.side_qty || 0); i++) {
                sideTotal++;
                const isMissingPhysically = i >= (card.owned_qty || 0);
                const style = isMissingPhysically ? "filter: grayscale(100%); opacity: 0.6; cursor: pointer;" : "cursor: pointer;";
                
                sideZone.innerHTML += `
                    <div class="col-2 mb-2 position-relative">
                        ${this.getBanlistBadge(card)}
                        <img src="${card.image_url}" class="img-fluid rounded" style="${style}"
                             oncontextmenu="DeckBuilder.removeCard('${card.id}', event, 'side')"
                             title="Click DX per rimuovere dal Side Deck">
                    </div>
                `;
            }
        });

        document.getElementById('dbMainCount').innerText = `${mainTotal} / 60`;
        document.getElementById('dbMainStatus').innerText = `Fisiche: ${mainOwned} - Mancanti: ${mainWish}`;
        
        document.getElementById('dbExtraCount').innerText = `${extraTotal} / 15`;
        document.getElementById('dbExtraStatus').innerText = `Fisiche: ${extraOwned} - Mancanti: ${extraWish}`;
        
        document.getElementById('dbSideCount').innerText = `${sideTotal} / 15`;
    },

    async addCard(cardId, event, zone) {
        if (event) event.preventDefault();
        if (!this.currentDeckId) return showToast("Seleziona prima un mazzo dal menu in alto!", "warning");

        let card = this.allUserCards.find(c => c.id == cardId);
        if (!card) card = this.apiSearchCache[cardId];
        
        if (!card) {
            return showToast("Errore temporaneo di caricamento della carta.", "danger");
        }

        const existingCard = this.currentDeckCards.find(c => c.id == cardId);
        const copiesInDeck = existingCard ? ((existingCard.deck_qty || 0) + (existingCard.side_qty || 0)) : 0;
        
        if (copiesInDeck >= 3) {
            return showToast(`Hai già raggiunto il limite di 3 copie per "${card.name}"!`, "warning");
        }

        if (zone === 'side') {
            let currentSide = 0;
            this.currentDeckCards.forEach(c => currentSide += (c.side_qty || 0));
            if (currentSide >= 15) return showToast("Side Deck pieno (Max 15)!", "warning");
        } else {
            const isExtra = this.isExtraDeckCard(card);
            if (isExtra) {
                let currentExtra = 0;
                this.currentDeckCards.forEach(c => { if (this.isExtraDeckCard(c)) currentExtra += (c.deck_qty || 0); });
                if (currentExtra >= 15) return showToast("Extra Deck pieno (Max 15)!", "warning");
            } else {
                if (!this.isValidMainDeckCard(card)) return showToast("Carta non valida per il Main Deck!", "warning");
                let currentMain = 0;
                this.currentDeckCards.forEach(c => { if (!this.isExtraDeckCard(c)) currentMain += (c.deck_qty || 0); });
                if (currentMain >= 60) return showToast("Main Deck pieno (Max 60)!", "warning");
            }
        }

        try {
            await fetch(`/api/decks/${this.currentDeckId}/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    card_id: cardId, zone: zone, name: card.name, image_url: card.image_url,
                    card_type: card.card_type, card_subtype: card.card_subtype,
                    attribute: card.attribute, race: card.race, level: card.level 
                })
            });
            await this.fetchUserCards();
            this.loadDeck(this.currentDeckId);
        } catch (error) {
            showToast("Errore di connessione durante l'inserimento.", "danger");
        }
    },

    async removeCard(cardId, event, zone) {
        if (event) event.preventDefault();
        
        await fetch(`/api/decks/${this.currentDeckId}/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card_id: cardId, zone: zone })
        });
        this.loadDeck(this.currentDeckId);
    },

    handleDragStart(event, cardId) {
        event.dataTransfer.setData("card_id", cardId);
    },

    handleDrop(event, targetZone) {
        event.preventDefault();
        const cardId = event.dataTransfer.getData("card_id");
        if (cardId) this.addCard(cardId, null, targetZone);
    },

    inspectCard(cardId) {
        let card = this.currentDeckCards.find(c => c.id == cardId);
        if (!card) card = this.allUserCards.find(c => c.id == cardId);
        if (!card) card = this.apiSearchCache[cardId];

        document.getElementById('dbModalTitle').innerText = card.name;
        document.getElementById('dbModalImg').src = card.image_url;
        document.getElementById('dbModalPhysQty').innerText = card.owned_qty || 0;
        document.getElementById('dbModalWishQty').innerText = card.wishlist_qty || 0;
        
        document.getElementById('dbModalCollBtn').onclick = () => this.quickAddAPI(card, 'owned');
        document.getElementById('dbModalWishBtn').onclick = () => this.quickAddAPI(card, 'wishlist');
        
        const modal = new bootstrap.Modal(document.getElementById('dbInspectModal'));
        modal.show();
    },

    async quickAddAPI(card, targetType) {
        await fetch('/api/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: card.id, name: card.name, image_url: card.image_url,
                update_type: targetType, action: 'add',
                card_type: card.card_type, card_subtype: card.card_subtype,
                attribute: card.attribute, race: card.race, level: card.level 
            })
        });
        
        const dest = targetType === 'owned' ? 'Collezione' : 'Wishlist';
        // CORRETTO: Verde (bg-success) per la collezione, Giallo per la wishlist
        const toastType = targetType === 'owned' ? 'success' : 'warning';
        showToast(`"${card.name}" aggiunta alla ${dest}!`, toastType);
        
        if (typeof window.loadMyCards === 'function') {
            window.loadMyCards();
        }
        
        bootstrap.Modal.getInstance(document.getElementById('dbInspectModal')).hide();
        await this.fetchUserCards();
        this.loadDeck(this.currentDeckId);
    },

    exportYDK() {
        if (!this.currentDeckId || this.currentDeckCards.length === 0) return;
        
        const select = document.getElementById('dbDeckSelect');
        const deckName = select.options[select.selectedIndex].text;
        
        let ydk = "#created by Yu-Gi-Oh! Manager\r\n";
        
        ydk += "#main\r\n";
        this.currentDeckCards.forEach(card => {
            if (!this.isExtraDeckCard(card)) {
                for (let i = 0; i < (card.deck_qty || 0); i++) ydk += `${card.id}\r\n`;
            }
        });
        
        ydk += "#extra\r\n";
        this.currentDeckCards.forEach(card => {
            if (this.isExtraDeckCard(card)) {
                for (let i = 0; i < (card.deck_qty || 0); i++) ydk += `${card.id}\r\n`;
            }
        });
        
        ydk += "!side\r\n";
        this.currentDeckCards.forEach(card => {
            for (let i = 0; i < (card.side_qty || 0); i++) ydk += `${card.id}\r\n`;
        });
        
        const blob = new Blob([ydk], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${deckName.replace(/\s+/g, '_')}.ydk`;
        a.click();
        window.URL.revokeObjectURL(url);
    },

    importYDK(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            const lines = text.split('\n');
            
            let currentZone = '';
            let cardsToImport = [];
            
            for (let line of lines) {
                line = line.trim();
                if (line === '#main' || line === '#extra') currentZone = 'main';
                else if (line === '!side') currentZone = 'side';
                else if (line && !line.startsWith('#') && !line.startsWith('!')) {
                    const cardId = parseInt(line);
                    if (!isNaN(cardId)) {
                        cardsToImport.push({ id: cardId, zone: currentZone });
                    }
                }
            }
            
            if (cardsToImport.length === 0) {
                showToast("File YDK vuoto o non valido.", "warning");
                return;
            }

            const deckName = prompt("Che nome vuoi dare al mazzo importato?", file.name.replace('.ydk', ''));
            if (!deckName) return;

            document.getElementById('dbLoadingSpinner').style.display = 'block';

            try {
                const response = await fetch('/api/decks/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: deckName, cards: cardsToImport })
                });
                
                const result = await response.json();
                document.getElementById('dbLoadingSpinner').style.display = 'none';
                
                if (result.success) {
                    await this.loadDecksDropdown();
                    await this.fetchUserCards();
                    
                    document.getElementById('dbDeckSelect').value = result.deck_id;
                    this.loadDeck(result.deck_id);
                    
                    showToast("Mazzo importato con successo!", "success");
                }
            } catch (error) {
                document.getElementById('dbLoadingSpinner').style.display = 'none';
                showToast("Errore durante l'importazione.", "danger");
            }
        };
        
        reader.readAsText(file);
        event.target.value = '';
    },

    fullMainDeckPool: [], 
    testDeckPool: [],     

    openTestDraw() {
        let pool = [];
        this.currentDeckCards.forEach(card => {
            if (!this.isExtraDeckCard(card)) {
                const qty = card.deck_qty || 0;
                for (let i = 0; i < qty; i++) {
                    pool.push(card);
                }
            }
        });

        if (pool.length < 5) {
            showToast("Il Main Deck deve contenere almeno 5 carte!", "warning");
            return;
        }

        this.fullMainDeckPool = pool; 
        this.startTestDraw();

        const modal = new bootstrap.Modal(document.getElementById('dbTestDrawModal'));
        modal.show();
    },

    startTestDraw() {
        let deck = [...this.fullMainDeckPool];
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        this.testDeckPool = deck;

        const hand = this.testDeckPool.splice(0, 5);
        this.renderHand(hand);
    },

    drawSingleCard() {
        if (this.testDeckPool.length === 0) {
            showToast("Il mazzo è esaurito!", "warning");
            return;
        }
        
        const card = this.testDeckPool.shift(); 
        const container = document.getElementById('dbHandContainer');
        
        container.innerHTML += `
            <div class="col-4 col-md-2 card-box animate__animated animate__fadeIn position-relative">
                ${this.getBanlistBadge(card)}
                <img src="${card.image_url}" class="img-fluid rounded shadow" style="max-height: 200px; cursor: pointer; transition: transform 0.2s;" 
                     onclick="DeckBuilder.openLightbox(this.src)" 
                     onmouseover="this.style.transform='scale(1.05)'" 
                     onmouseout="this.style.transform='scale(1)'">
                <p class="small text-truncate mt-1 mb-0" title="${card.name}">${card.name}</p>
            </div>
        `;
        
        document.getElementById('dbDrawCount').innerText = this.testDeckPool.length;
    },

    renderHand(handCards) {
        const container = document.getElementById('dbHandContainer');
        container.innerHTML = '';

        handCards.forEach(card => {
            container.innerHTML += `
                <div class="col-4 col-md-2 card-box position-relative">
                    ${this.getBanlistBadge(card)}
                    <img src="${card.image_url}" class="img-fluid rounded shadow" style="max-height: 200px; cursor: pointer; transition: transform 0.2s;" 
                         onclick="DeckBuilder.openLightbox(this.src)" 
                         onmouseover="this.style.transform='scale(1.05)'" 
                         onmouseout="this.style.transform='scale(1)'">
                    <p class="small text-truncate mt-1 mb-0" title="${card.name}">${card.name}</p>
                </div>
            `;
        });

        document.getElementById('dbDrawCount').innerText = this.testDeckPool.length;
    },

    openLightbox(imgUrl) {
        document.getElementById('dbLightboxImg').src = imgUrl;
        const lightboxModal = new bootstrap.Modal(document.getElementById('dbLightboxModal'));
        lightboxModal.show();
    },

    currentBanlist: 'ban_tcg',
    customBanlistData: {}, 
    activeCustomFilename: null, 

    async loadAvailableBanlists() {
        try {
            const res = await fetch('/api/banlists');
            const files = await res.json();
            const group = document.getElementById('customBanlistGroup');
            group.innerHTML = '';
            
            if (files.length === 0) {
                group.innerHTML = '<option value="" disabled>Nessun file in banlist/</option>';
                return;
            }

            files.forEach(filename => {
                group.innerHTML += `<option value="custom_${filename}">📜 ${filename}</option>`;
            });
        } catch (e) {
            console.error("Errore caricamento banlist custom:", e);
        }
    },

    async handleBanlistChange(value) {
        const deleteBtn = document.getElementById('dbDeleteBanlistBtn');

        if (value === 'upload_new') {
            document.getElementById('dbConfLoader').click();
            deleteBtn.style.display = 'none';
            return;
        }
        
        if (value.startsWith('custom_')) {
            const filename = value.replace('custom_', '');
            this.activeCustomFilename = filename;
            deleteBtn.style.display = 'inline-block';
            await this.fetchAndApplyCustomBanlist(filename);
            return;
        }

        this.activeCustomFilename = null;
        if (deleteBtn) deleteBtn.style.display = 'none';
        
        this.currentBanlist = value;
        this.renderDeck();
        this.searchApi();
    },

    async fetchAndApplyCustomBanlist(filename) {
        try {
            const res = await fetch(`/api/banlists/${filename}`);
            const data = await res.json();
            
            if (!data.success) {
                showToast("Errore nel leggere il file di banlist.", "danger");
                return;
            }

            this.parseConfContent(data.content);
            this.currentBanlist = 'custom';
            showToast(`Banlist '${filename}' applicata con successo!`, 'success');  
            this.renderDeck();
            this.searchApi();
        } catch (e) {
            showToast("Errore di connessione al server.", "danger");
        }
    },

    async uploadCustomBanlist(event) {
        const file = event.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/banlists/upload', {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            
            if (result.success) {
                showToast(`File '${result.filename}' salvato nella cartella banlist!`, 'success');
                await this.loadAvailableBanlists();
                document.getElementById('dbBanlistSelect').value = `custom_${result.filename}`;
                this.handleBanlistChange(`custom_${result.filename}`);
            } else {
                showToast("Errore durante l'upload: " + result.error, 'danger');
            }
        } catch (e) {
            showToast("Errore di rete durante l'upload.", "danger");
        }

        event.target.value = '';
    },

    async deleteActiveCustomBanlist() {
        if (!this.activeCustomFilename) return;

        if (!confirm(`Sei sicuro di voler eliminare definitivamente il file '${this.activeCustomFilename}' dal server?`)) {
            return;
        }

        try {
            const res = await fetch(`/api/banlists/${this.activeCustomFilename}`, {
                method: 'DELETE'
            });
            const result = await res.json();

            if (result.success) {
                showToast("Banlist eliminata con successo!", 'success');
                this.activeCustomFilename = null;
                document.getElementById('dbDeleteBanlistBtn').style.display = 'none';
                
                document.getElementById('dbBanlistSelect').value = 'ban_tcg';
                this.handleBanlistChange('ban_tcg');
                await this.loadAvailableBanlists();
            } else {
                showToast("Errore durante l'eliminazione: " + result.error, 'danger');
            }
        } catch (e) {
            showToast("Errore durante l'eliminazione del file", 'danger');
        }
    },

    parseConfContent(text) {
        const lines = text.split('\n');
        this.customBanlistData = {};
        
        lines.forEach(line => {
            let cleanLine = line.split('#')[0].split('--')[0].trim();
            if (!cleanLine) return; 
            
            const parts = cleanLine.split(/\s+/);
            if (parts.length >= 2) {
                const id = String(parts[0]).trim();
                const limit = parseInt(parts[1], 10);
                
                if (!isNaN(limit)) {
                    if (limit === 0) this.customBanlistData[id] = 'Banned';
                    if (limit === 1) this.customBanlistData[id] = 'Limited';
                    if (limit === 2) this.customBanlistData[id] = 'Semi-Limited';
                }
            }
        });
    },

    getBanlistBadge(card) {
        if (this.currentBanlist === 'none') return '';

        let status = null;
        let releaseDate = card.tcg_date || '2099-01-01';

        if (this.currentBanlist === 'custom') {
            const cardIdStr = String(card.id).trim();
            status = this.customBanlistData[cardIdStr];
        } 
        else if (this.currentBanlist === 'ban_goat') {
            if (releaseDate > '2005-08-31') {
                return `<div class="ban-badge banned">🚫</div>`;
            }
            let info = this.parseCardBanInfo(card);
            status = info['ban_goat'];
            if (status === 'Forbidden') status = 'Banned';
        } 
        else if (this.currentBanlist === 'ban_edison') {
            if (releaseDate > '2010-04-30') {
                return `<div class="ban-badge banned">🚫</div>`;
            }
            let info = this.parseCardBanInfo(card);
            status = info['ban_tcg'] || info['ban_ocg'];
            if (status === 'Forbidden') status = 'Banned';
        } 
        else {
            let info = this.parseCardBanInfo(card);
            status = info[this.currentBanlist];
            if (status === 'Forbidden') status = 'Banned';
        }

        if (status === 'Banned') return `<div class="ban-badge banned">🚫</div>`;
        if (status === 'Limited') return `<div class="ban-badge">1</div>`;
        if (status === 'Semi-Limited') return `<div class="ban-badge">2</div>`;
        
        return '';
    },

    parseCardBanInfo(card) {
        if (!card.banlist_info) return {};
        try {
            return typeof card.banlist_info === 'string' ? JSON.parse(card.banlist_info) : card.banlist_info;
        } catch (e) {
            return {};
        }
    }
};

// Funzione Toast Universale Stabile (3 secondi fissi, non si sovrappongono)
function showToast(message, type = 'success') {
    let container = document.getElementById('globalToastContainer');
    
    if (!container) {
        container = document.createElement('div');
        container.id = 'globalToastContainer';
        container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        container.style.zIndex = '1080';
        document.body.appendChild(container);
    }

    let bgClass = 'bg-success';
    if (type === 'danger' || type === 'error') bgClass = 'bg-danger';
    if (type === 'warning') bgClass = 'bg-warning text-dark';
    if (type === 'info') bgClass = 'bg-info text-dark';

    const toastId = 'toast_' + Date.now() + Math.random().toString(36).substring(2, 5);
    const toastHTML = `
        <div id="${toastId}" class="toast align-items-center text-white ${bgClass} border-0 shadow" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="d-flex">
                <div class="toast-body fw-bold">
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', toastHTML);

    const toastElement = document.getElementById(toastId);
    const bsToast = new bootstrap.Toast(toastElement, {
        delay: 3000, 
        autohide: true
    });

    bsToast.show();

    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}


let cardDataStorage = {};
let searchResultsAll = []; 
let currentPage = 1;
const itemsPerPage = 20;

const levelSelect = document.getElementById('fLevel');
for(let i=1; i<=13; i++) levelSelect.innerHTML += `<option value="${i}">${i}</option>`;

function showTab(tabName) {
        document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
        
        document.getElementById(tabName + '-tab').style.display = 'block';
        if(event && event.target) event.target.classList.add('active');
        
        const filterPanel = document.getElementById('filter-panel');
        if (tabName === 'deckbuilder' || tabName === 'search') {
            filterPanel.style.display = 'none';
        } else {
            filterPanel.style.display = 'flex';
            applyFilters(); // Aggiorna i contatori non appena si apre la Collezione o la Wishlist!
        }

        if (tabName === 'deckbuilder' && typeof DeckBuilder !== 'undefined') {
            DeckBuilder.init();
        }
    }

function updateSubFilters() {
    const type = document.getElementById('fType').value;
    const subType = document.getElementById('fSubType');
    const attr = document.getElementById('fAttribute');
    const race = document.getElementById('fRace');
    const level = document.getElementById('fLevel');

    subType.innerHTML = '<option value="">Sottotipo</option>';

    if (type === 'Mostro') {
        attr.disabled = false; race.disabled = false; level.disabled = false;
        ['Normal', 'Effect', 'Fusion', 'Ritual', 'Synchro', 'Xyz', 'Pendulum', 'Link', 'Tuner', 'Token'].forEach(t => subType.innerHTML += `<option value="${t}">${t}</option>`);
    } else if (type === 'Magia') {
        attr.disabled = true; race.disabled = true; level.disabled = true;
        attr.value = ""; race.value = ""; level.value = "";
        ['Normal', 'Quick-Play', 'Continuous', 'Field', 'Equip', 'Ritual'].forEach(t => subType.innerHTML += `<option value="${t}">${t}</option>`);
    } else if (type === 'Trappola') {
        attr.disabled = true; race.disabled = true; level.disabled = true;
        attr.value = ""; race.value = ""; level.value = "";
        ['Normal', 'Continuous', 'Counter'].forEach(t => subType.innerHTML += `<option value="${t}">${t}</option>`);
    } else {
        attr.disabled = false; race.disabled = false; level.disabled = false;
    }
}

async function searchCardsApi() {
    const query = document.getElementById('searchInput').value.trim();
    const container = document.getElementById('searchResults');
    const resultCountLabel = document.getElementById('apiResultCount');
    
    // Se la barra è vuota, pulisci lo schermo immediatamente
    if (query === "") {
        container.innerHTML = '';
        resultCountLabel.innerText = '';
        return;
    }

    try {
        const res = await fetch(`/api/search?q=${query}`);
        const searchResultsAll = await res.json();
        
        container.innerHTML = '';
        
        if (searchResultsAll.length === 0) {
            resultCountLabel.innerText = "Nessuna carta trovata.";
            return;
        } 
        
        resultCountLabel.innerText = `Primi ${searchResultsAll.length} risultati trovati.`;
        
        // Rendering istantaneo
        searchResultsAll.forEach(card => {
            cardDataStorage[card.id] = card;
            container.innerHTML += `
                <div class="col-6 col-md-3 card-box">
                    <!-- Immagine ora cliccabile con effetto zoom -->
                    <img src="${card.image_url}" class="card-img img-fluid" style="cursor: pointer; transition: transform 0.2s;" onclick="DeckBuilder.openLightbox(this.src)" title="Clicca per ingrandire" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                    
                    <p class="mt-2 text-truncate" title="${card.name}">${card.name}</p>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-success" onclick="updateCard('${card.id}', 'owned', 'add')">+ Coll.</button>
                        <button class="btn btn-warning" onclick="updateCard('${card.id}', 'wishlist', 'add')">+ Wish</button>
                    </div>
                </div>
            `;
        });
    } catch (error) {
        resultCountLabel.innerText = "Errore durante la ricerca.";
    }
}


async function loadMyCards() {
    const res = await fetch('/api/cards');
    const cards = await res.json();
    
    const collContainer = document.getElementById('collectionResults');
    const wishContainer = document.getElementById('wishlistResults');
    collContainer.innerHTML = ''; wishContainer.innerHTML = '';

    cards.forEach(card => {
        cardDataStorage[card.id] = card;
        if (card.owned_qty > 0) collContainer.innerHTML += renderCardHTML(card, 'owned', card.owned_qty);
        if (card.wishlist_qty > 0) wishContainer.innerHTML += renderCardHTML(card, 'wishlist', card.wishlist_qty);
    });

    sortCards();
    applyFilters(); 
}

function renderCardHTML(card, updateType, qty) {
    return `
        <div class="col-6 col-md-3 card-box" 
                data-type="${card.card_type || ''}" 
                data-subtype="${card.card_subtype || ''}" 
                data-attr="${card.attribute || ''}" 
                data-race="${card.race || ''}" 
                data-level="${card.level || ''}"
                data-qty="${qty}">
            
            <!-- Immagine ora cliccabile con effetto zoom -->
            <img src="${card.image_url}" class="card-img img-fluid" style="cursor: pointer; transition: transform 0.2s;" onclick="DeckBuilder.openLightbox(this.src)" title="Clicca per ingrandire" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
            
            <p class="mt-2 mb-1 text-truncate" title="${card.name}">${card.name}</p>
            <div class="d-flex justify-content-center align-items-center gap-2">
                <button class="btn btn-sm btn-danger" onclick="updateCard('${card.id}', '${updateType}', 'remove')">-</button>
                <span class="badge bg-secondary">Q.tà: ${qty}</span>
                <button class="btn btn-sm btn-success" onclick="updateCard('${card.id}', '${updateType}', 'add')">+</button>
            </div>
        </div>
    `;
}

async function updateCard(id, updateType, action) {
    const cardData = cardDataStorage[id];
    cardData.update_type = updateType;
    cardData.action = action;

    await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cardData)
    });
    
    if (action === 'add' && document.getElementById('search-tab').style.display !== 'none') {
        const dest = updateType === 'owned' ? 'Collezione' : 'Wishlist';
        document.getElementById('toastMessage').innerText = `"${cardData.name}" aggiunta in ${dest}!`;
        
        const toastEl = document.getElementById('liveToast');
        const closeBtn = document.getElementById('toastCloseBtn');
        
        toastEl.className = 'toast align-items-center border-0 ' + (updateType === 'owned' ? 'text-bg-success' : 'text-bg-warning text-dark');
        closeBtn.className = 'btn-close me-2 m-auto ' + (updateType === 'owned' ? 'btn-close-white' : '');
        
        const toast = new bootstrap.Toast(toastEl);
        toast.show();
    }
    
    loadMyCards();
}

function getCardWeight(type, subtype) {
    if (type === 'Mostro') {
        if (subtype.includes('Token')) return 80;
        if (subtype.includes('Link')) return 70;
        if (subtype.includes('Pendulum')) return 60;
        if (subtype.includes('Xyz')) return 50;
        if (subtype.includes('Synchro')) return 40;
        if (subtype.includes('Fusion')) return 30;
        if (subtype.includes('Effect') || subtype.includes('Ritual')) return 20;
        if (subtype.includes('Normal')) return 10;
        return 90;
    } else if (type === 'Magia') {
        if (subtype === 'Normal') return 101;
        if (subtype === 'Quick-Play') return 102;
        if (subtype === 'Continuous') return 103;
        if (subtype === 'Field') return 104;
        if (subtype === 'Equip') return 105;
        if (subtype === 'Ritual') return 106;
        return 199;
    } else if (type === 'Trappola') {
        if (subtype === 'Normal') return 201;
        if (subtype === 'Continuous') return 202;
        if (subtype === 'Counter') return 203;
        return 299;
    }
    return 999;
}

function sortCards() {
    const activeContainerId = document.getElementById('collection-tab').style.display !== 'none' ? 'collectionResults' : 'wishlistResults';
    const container = document.getElementById(activeContainerId);
    if (!container) return;

    const cards = Array.from(container.getElementsByClassName('card-box'));
    const sortMode = document.getElementById('fSort').value;

    cards.sort((a, b) => {
        const nameA = a.querySelector('p').innerText;
        const nameB = b.querySelector('p').innerText;

        if (sortMode === 'alpha') {
            return nameA.localeCompare(nameB);
        } else if (sortMode === 'type') {
            const weightA = getCardWeight(a.dataset.type, a.dataset.subtype);
            const weightB = getCardWeight(b.dataset.type, b.dataset.subtype);
            
            if (weightA === weightB) {
                return nameA.localeCompare(nameB);
            }
            return weightA - weightB;
        }
    });

    cards.forEach(card => container.appendChild(card));
}

function applyFilters() {
    const activeContainerId = document.getElementById('collection-tab').style.display !== 'none' ? 'collectionResults' : 'wishlistResults';
    const container = document.getElementById(activeContainerId);
    if (!container) return; 
    
    const cards = container.getElementsByClassName('card-box');
    
    const qText = document.getElementById('searchInputLocal').value.toLowerCase();
    const qType = document.getElementById('fType').value;
    const qSubType = document.getElementById('fSubType').value;
    const qLevel = document.getElementById('fLevel').value;
    const qAttr = document.getElementById('fAttribute').value;
    const qRace = document.getElementById('fRace').value;

    let visibleCopies = 0;
    let totalCopies = 0;

    for (let card of cards) {
        const cName = card.querySelector('p').innerText.toLowerCase();
        const dType = card.dataset.type;
        const dSubType = card.dataset.subtype;
        const dAttr = card.dataset.attr;
        const dRace = card.dataset.race;
        const dLevel = card.dataset.level;
        
        // Recupero la quantità esatta di questa carta 
        const qty = parseInt(card.dataset.qty) || 0;

        let match = true;
        if (qText && !cName.includes(qText)) match = false;
        if (qType && dType !== qType) match = false;
        if (qSubType && !dSubType.includes(qSubType)) match = false;
        if (qLevel && dLevel !== qLevel) match = false;
        if (qAttr && dAttr !== qAttr) match = false;
        if (qRace && dRace !== qRace) match = false;

        totalCopies += qty; // Somma le copie totali contenute nella tab

        if (match) {
            card.style.display = '';
            visibleCopies += qty; // Somma le copie che superano i filtri
        } else {
            card.style.display = 'none';
        }
    }
    
    // Cambia la dicitura dinamicamente in base a quale pannello stai guardando
    const labelTesto = activeContainerId === 'collectionResults' ? 'Copie Fisiche' : 'Copie da Comprare';
    document.getElementById('counterDisplay').innerText = `${visibleCopies} / ${totalCopies} ${labelTesto}`;
}

const originalShowTab = showTab;
showTab = function(tabName) {
    originalShowTab(tabName);
    if (tabName === 'deckbuilder') {
        DeckBuilder.init();
    }
};

loadMyCards();

async function syncGlobalDatabase() {
    const btn = document.getElementById('btnSyncDb');
    const spinner = document.getElementById('loadingSpinner');
    const text = document.getElementById('loadingText');
    
    if (!confirm("Vuoi scaricare le informazioni di tutte le 14.000+ carte? Potrebbe volerci qualche secondo.")) return;
    
    btn.disabled = true;
    spinner.style.display = 'block';
    text.innerText = "Download del database globale in corso, attendere...";
    document.getElementById('searchResults').innerHTML = '';
    
    try {
        const res = await fetch('/api/sync_db', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert(`Database sincronizzato! ${data.count} carte salvate localmente.`);
        } else {
            alert("Errore durante la sincronizzazione.");
        }
    } catch (e) {
        alert("Errore di connessione.");
    }
    
    btn.disabled = false;
    spinner.style.display = 'none';
    text.innerText = "Ricerca nel database in corso...";
}

// Invia un segnale di spegnimento "silenzioso" quando la scheda viene chiusa
//window.addEventListener('beforeunload', function (e) {
//    navigator.sendBeacon('/api/shutdown');
//});