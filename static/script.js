const DeckBuilder = {
    currentDeckId: null,
    allUserCards: [],
    currentDeckCards: [],
    apiSearchCache: {},
    
    async init() {
        await this.loadDecksDropdown();
        await this.fetchUserCards();
        
        // NUOVO: Ricarica visivamente il mazzo se ne avevi già uno aperto
        // Così le carte che hai appena "comprato" non saranno più grigie!
        if (this.currentDeckId) {
            await this.loadDeck(this.currentDeckId);
        }
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
let currentPage = 1;
const itemsPerPage = 20;
let allMyCards = [];
let currentFilteredCards = [];

const levelSelect = document.getElementById('fLevel');
for(let i=1; i<=13; i++) levelSelect.innerHTML += `<option value="${i}">${i}</option>`;

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    
    document.getElementById(tabName + '-tab').style.display = 'block';
    if(event && event.target) event.target.classList.add('active');
    
    const filterPanel = document.getElementById('filter-panel');
    
    // MODIFICA QUI: Aggiunto 'analyzer' alla lista dei tab senza pannello filtri
    if (tabName === 'deckbuilder' || tabName === 'search' || tabName === 'analyzer') {
        filterPanel.style.display = 'none';
    } else {
        filterPanel.style.display = 'flex';
        currentPage = 1;
        loadMyCards(); // Ricarica i dati aggiornati dal server ogni volta che apri il tab!
    }

    if (tabName === 'deckbuilder' && typeof DeckBuilder !== 'undefined') {
        DeckBuilder.init();
    }
    
    // NUOVO BLOCCCHETTO: Aggiorna la tendina dell'analyzer quando lo apri
    if (tabName === 'analyzer' && typeof DeckAnalyzer !== 'undefined') {
        DeckAnalyzer.populateDropdown();
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
    allMyCards = await res.json(); // Invece di metterle tutte nel DOM, le salviamo nell'array
    
    allMyCards.forEach(card => {
        cardDataStorage[card.id] = card;
    });

    currentPage = 1;
    applyFilters(); 
}

function renderCardHTML(card, updateType, qty) {
    return `
        <div class="col-6 col-md-3 card-box">
            
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
    currentPage = 1;
    applyFilters();
}

function changePage(direction) {
    currentPage += direction;
    const activeTab = document.getElementById('collection-tab').style.display !== 'none' ? 'owned' : 'wishlist';
    renderCurrentPage(activeTab);
    // Scorre la pagina dolcemente verso l'alto quando cambi pagina
    document.getElementById('filter-panel').scrollIntoView({ behavior: 'smooth' });
}

async function updateCard(id, updateType, action) {
    const cardData = cardDataStorage[id] || { id: id };
    cardData.update_type = updateType;
    cardData.action = action;

    await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cardData)
    });
    
    if (document.getElementById('search-tab').style.display !== 'none') {
        const dest = updateType === 'owned' ? 'Collezione' : 'Wishlist';
        const toastType = updateType === 'owned' ? 'success' : 'warning';
        showToast(`"${cardData.name || 'Carta'}" aggiunta in ${dest}!`, toastType);
    }
    
    // Ricarica istantaneamente i dati aggiornati dal database
    await loadMyCards();
}

function applyFilters() {
    currentPage = 1;
    const activeTab = document.getElementById('collection-tab').style.display !== 'none' ? 'owned' : 'wishlist';
    
    if (event && event.type === 'keyup') currentPage = 1; 

    const qText = document.getElementById('searchInputLocal').value.toLowerCase();
    const qType = document.getElementById('fType').value;
    const qSubType = document.getElementById('fSubType').value;
    const qLevel = document.getElementById('fLevel').value;
    const qAttr = document.getElementById('fAttribute').value;
    const qRace = document.getElementById('fRace').value;

    let visibleCopies = 0;
    let totalCopies = 0;

    // Filtra direttamente l'array in memoria (velocissimo, ignora il DOM)
    currentFilteredCards = allMyCards.filter(card => {
        const qty = activeTab === 'owned' ? (card.owned_qty || 0) : (card.wishlist_qty || 0);
        if (qty === 0) return false;

        totalCopies += qty;

        const cName = (card.name || '').toLowerCase();
        const dType = card.card_type || '';
        const dSubType = card.card_subtype || '';
        const dAttr = card.attribute || '';
        const dRace = card.race || '';
        const dLevel = String(card.level || '');

        let match = true;
        if (qText && !cName.includes(qText)) match = false;
        
        if (qType) {
            const isMonster = dType === 'Mostro' || dType.includes('Monster');
            const isSpell = dType === 'Magia' || dType.includes('Spell');
            const isTrap = dType === 'Trappola' || dType.includes('Trap');
            
            if (qType === 'Mostro' && !isMonster) match = false;
            if (qType === 'Magia' && !isSpell) match = false;
            if (qType === 'Trappola' && !isTrap) match = false;
        }

        if (qSubType && !dSubType.includes(qSubType)) match = false;
        if (qLevel && dLevel !== qLevel) match = false;
        if (qAttr && dAttr !== qAttr) match = false;
        if (qRace && dRace !== qRace) match = false;

        if (match) visibleCopies += qty;
        
        return match;
    });

    const sortMode = document.getElementById('fSort').value;
    currentFilteredCards.sort((a, b) => {
        const nameA = a.name || '';
        const nameB = b.name || '';
        if (sortMode === 'alpha') return nameA.localeCompare(nameB);
        
        if (sortMode === 'type') {
            const weightA = getCardWeight(a.card_type, a.card_subtype);
            const weightB = getCardWeight(b.card_type, b.card_subtype);
            if (weightA === weightB) return nameA.localeCompare(nameB);
            return weightA - weightB;
        }
    });

    renderCurrentPage(activeTab);

    const labelTesto = activeTab === 'owned' ? 'Copie Fisiche' : 'Copie da Comprare';
    document.getElementById('counterDisplay').innerText = `${visibleCopies} / ${totalCopies} ${labelTesto}`;
}

function renderCurrentPage(activeTab) {
    const isOwned = activeTab === 'owned';
    const container = document.getElementById(isOwned ? 'collectionResults' : 'wishlistResults');
    const pagination = document.getElementById(isOwned ? 'collectionPagination' : 'wishlistPagination');
    if (!container || !pagination) return;

    const totalPages = Math.max(1, Math.ceil(currentFilteredCards.length / itemsPerPage));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const start = (currentPage - 1) * itemsPerPage;
    container.innerHTML = currentFilteredCards
        .slice(start, start + itemsPerPage)
        .map(card => renderCardHTML(card, activeTab, isOwned ? card.owned_qty : card.wishlist_qty))
        .join('');

    if (currentFilteredCards.length === 0) {
        pagination.innerHTML = '';
        return;
    }

    pagination.innerHTML = `
        <button class="btn btn-outline-light" ${currentPage <= 1 ? 'disabled' : ''}
                onclick="changePage(-1)" aria-label="Pagina precedente">❮</button>
        <span class="fw-bold">Pagina ${currentPage} di ${totalPages}</span>
        <button class="btn btn-outline-light" ${currentPage >= totalPages ? 'disabled' : ''}
                onclick="changePage(1)" aria-label="Pagina successiva">❯</button>
    `;
}

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


const DeckAnalyzer = {
    currentDeck: [],
    categories: {}, 
    chartInstance: null, // Salva il grafico per poterlo aggiornare

    // 1. Popola tendina (Invariato)
    populateDropdown: async function() {
        const select = document.getElementById('analyzerDeckSelect');
        if (!select) return;
        try {
            const res = await fetch('/api/decks');
            const decks = await res.json();
            select.innerHTML = '<option value="">Seleziona un mazzo da analizzare...</option>';
            decks.forEach(deck => {
                select.innerHTML += `<option value="${deck.id}">${deck.name}</option>`;
            });
        } catch (err) { console.error("Errore lista mazzi:", err); }
    },

    // 2. Load Deck con FILTRO DEFINITIVO Extra/Side
    loadDeck: async function(deckId) {
        if (!deckId) {
            document.getElementById('analyzerCardList').innerHTML = '';
            this.updateUIAndMath();
            return;
        }
        
        try {
            let rawCards = [];
            
            // L'INTUIZIONE GENIALE: Usiamo i dati del Deck Builder se sono già lì!
            if (typeof DeckBuilder !== 'undefined' && 
                DeckBuilder.currentDeckId == deckId && 
                DeckBuilder.currentDeckCards) {
                
                rawCards = DeckBuilder.currentDeckCards;
                console.log("Dati presi dal Deck Builder!");
            } else {
                // Se apriamo l'analyzer senza passare dal deck builder, li scarichiamo
                const res = await fetch(`/api/decks/${deckId}`);
                rawCards = await res.json();
            }

            // Filtro Extra/Side deck (uguale a prima)
            const cardArray = rawCards.main ? rawCards.main : (Array.isArray(rawCards) ? rawCards : []);
            
            this.currentDeck = cardArray.filter(card => {
                const section = (card.section || card.board || card.deck_section || '').toLowerCase();
                if (section === 'side' || section === 'extra') return false;

                const type = (card.type || card.card_type || '').toLowerCase();
                const frame = (card.frameType || '').toLowerCase();
                
                const isExtra = type.includes('fusion') || type.includes('synchro') || 
                                type.includes('xyz') || type.includes('link') ||
                                frame.includes('fusion') || frame.includes('synchro') || 
                                frame.includes('xyz') || frame.includes('link') ||
                                type.includes('token');
                
                return !isExtra;
            });

            this.categories = {}; 
            this.renderCards();
            
        } catch (err) {
            console.error("Errore caricamento deck analyzer:", err);
        }
    },

    setCategory: function(cardName, category) {
        // Ora salviamo la categoria usando il NOME della carta, così vale per tutte le copie
        this.categories[cardName] = category;
        this.renderCards(); 
    },

    resetCategories: function() {
        this.categories = {};
        this.renderCards();
    },

    renderCards: function() {
        const container = document.getElementById('analyzerCardList');
        const uniqueCards = {};
        
        // Debug per vedere il nome esatto della colonna se serve
        if (this.currentDeck.length > 0) {
            console.log("🔍 Struttura di una carta del tuo deck:", this.currentDeck[0]);
        }

        this.currentDeck.forEach(c => {
            const name = c.name; 
            if (!uniqueCards[name]) {
                uniqueCards[name] = { ...c, totalQty: 0 };
            }
            // Usa il nuovo cercatore aggressivo!
            uniqueCards[name].totalQty += this.getCardQuantity(c);
        });

        let html = '';
        Object.values(uniqueCards).forEach(card => {
            const cat = this.categories[card.name] || 'brick'; 
            const btnCombo = cat === 'combo' ? 'btn-success' : 'btn-outline-success text-white';
            const btnHt = cat === 'ht' ? 'btn-warning text-dark' : 'btn-outline-warning text-white';
            const btnBrick = cat === 'brick' ? 'btn-danger' : 'btn-outline-danger text-white';
            
            const imageId = card.card_id || card.konami_id || card.id;

            html += `
                <div class="col-12 mb-2">
                    <div class="bg-dark border border-secondary rounded p-2 d-flex align-items-center gap-3">
                        <img src="https://images.ygoprodeck.com/images/cards/${imageId}.jpg" 
                             style="width: 50px; cursor: pointer;" 
                             onclick="typeof DeckBuilder !== 'undefined' ? DeckBuilder.openLightbox(this.src) : window.open(this.src)">
                        
                        <div class="flex-grow-1 overflow-hidden">
                            <div class="text-truncate fw-bold mb-1" title="${card.name}">
                                <span class="badge bg-secondary me-1">x${card.totalQty}</span>${card.name}
                            </div>
                            <div class="btn-group btn-group-sm w-100">
                                <button class="btn ${btnCombo}" onclick="DeckAnalyzer.setCategory('${card.name.replace(/'/g, "\\'")}', 'combo')">🚀 Combo</button>
                                <button class="btn ${btnHt}" onclick="DeckAnalyzer.setCategory('${card.name.replace(/'/g, "\\'")}', 'ht')">✋ HT</button>
                                <button class="btn ${btnBrick}" onclick="DeckAnalyzer.setCategory('${card.name.replace(/'/g, "\\'")}', 'brick')">🧱 Brick</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        this.updateUIAndMath();
    },

    // Nuova funzione Helper che trova automaticamente la colonna delle quantità del tuo Database!
    getCardQuantity: function(c) {
        // Cerca in modo intelligente tra tutte le chiavi della carta
        for (let key in c) {
            let k = key.toLowerCase();
            if (k.includes('qty') || k.includes('quantit') || k.includes('qta') || 
                k.includes('copi') || k.includes('count') || k.includes('amount')) {
                
                let val = parseInt(c[key]);
                if (!isNaN(val) && val > 0 && val <= 60) return val;
            }
        }
        return 1; // Se proprio non la trova, conta 1
    },

    combinations: function(n, k) {
        if (k < 0 || k > n) return 0;
        if (k === 0 || k === n) return 1;
        let c = 1;
        for (let i = 1; i <= k; i++) c = c * (n - i + 1) / i;
        return c;
    },

    hypergeometric: function(successesInDeck, totalInDeck, handSize, targetSuccesses) {
        const waysToDrawSuccesses = this.combinations(successesInDeck, targetSuccesses);
        const waysToDrawRest = this.combinations(totalInDeck - successesInDeck, handSize - targetSuccesses);
        const totalWays = this.combinations(totalInDeck, handSize);
        return (waysToDrawSuccesses * waysToDrawRest) / totalWays;
    },

    updateUIAndMath: function() {
        let totalCardsInMain = 0;
        let comboCount = 0;
        let htCount = 0;
        let brickCount = 0;

        const uniqueCards = {};
        this.currentDeck.forEach(c => {
            const name = c.name;
            if (!uniqueCards[name]) uniqueCards[name] = { totalQty: 0 };
            
            // Usa il nuovo cercatore aggressivo anche per i conti matematici!
            uniqueCards[name].totalQty += this.getCardQuantity(c);
        });

        Object.keys(uniqueCards).forEach(name => {
            const qty = uniqueCards[name].totalQty;
            const cat = this.categories[name] || 'brick';
            totalCardsInMain += qty;
            
            if (cat === 'combo') comboCount += qty;
            else if (cat === 'ht') htCount += qty;
            else brickCount += qty;
        });

        // Aggiorna Contatori
        const elTotal = document.getElementById('statTotalCards');
        if(elTotal) elTotal.innerText = totalCardsInMain;
        
        document.getElementById('statComboCount').innerText = comboCount;
        document.getElementById('statHtCount').innerText = htCount;
        document.getElementById('statBrickCount').innerText = brickCount;

        // --- GESTIONE GRAFICO A TORTA ---
        const ctx = document.getElementById('analyzerChart');
        if (ctx) {
            if (this.chartInstance) this.chartInstance.destroy();
            this.chartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Combo', 'Hand Traps', 'Bricks/Engine'],
                    datasets: [{
                        data: [comboCount, htCount, brickCount],
                        backgroundColor: ['#198754', '#ffc107', '#dc3545'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false } 
                    }
                }
            });
        }

        // --- GESTIONE MANI IMPOSSIBILI ---
        if (totalCardsInMain < 5) {
            document.getElementById('barPlayable').style.width = '0%';
            document.getElementById('barPlayable').innerText = '-';
            
            document.getElementById('barRedundant').style.width = '0%';
            document.getElementById('barRedundant').innerText = '-';
            
            document.getElementById('barBrick').style.width = '0%';
            document.getElementById('barBrick').innerText = '-';
            
            const verdictTitle = document.getElementById('analyzerVerdict');
            const verdictDesc = document.getElementById('analyzerVerdictDesc');
            if(verdictTitle) {
                verdictTitle.innerText = "❌ Carte Insufficienti";
                verdictDesc.innerText = "Servono almeno 5 carte nel Main Deck per calcolare la mano iniziale.";
                verdictTitle.className = "text-secondary fw-bold m-0";
            }
            return;
        }

        // --- MATEMATICA IPERGEOMETRICA BASATA SULLE CARTE REALI (totalCardsInMain) ---
        const handSize = 5;
        const prob0Combo = this.hypergeometric(comboCount, totalCardsInMain, handSize, 0);
        const prob1Combo = this.hypergeometric(comboCount, totalCardsInMain, handSize, 1);
        
        const probPlayable = 1 - prob0Combo;
        const probRedundant = probPlayable - prob1Combo;

        const percPlayable = (probPlayable * 100).toFixed(1);
        const percRedundant = (probRedundant * 100).toFixed(1);
        const percBrick = (prob0Combo * 100).toFixed(1);

        // Aggiorna Barre di progresso
        document.getElementById('barPlayable').style.width = percPlayable + '%';
        document.getElementById('barPlayable').innerText = percPlayable + '%';

        document.getElementById('barRedundant').style.width = percRedundant + '%';
        document.getElementById('barRedundant').innerText = percRedundant + '%';

        document.getElementById('barBrick').style.width = percBrick + '%';
        document.getElementById('barBrick').innerText = percBrick + '%';

        // --- VERDETTO (Nuova Logica Professionale) ---
        const verdictTitle = document.getElementById('analyzerVerdict');
        const verdictDesc = document.getElementById('analyzerVerdictDesc');

        const diffComboHt = Math.abs(comboCount - htCount);

        if (probPlayable < 0.70) {
            verdictTitle.innerText = "🧱 Rischio Brick Elevato";
            verdictDesc.innerText = `Solo ${percPlayable}% di partenza giocabile. Aggiungi starter o abbassa i brick.`;
            verdictTitle.className = "text-danger fw-bold m-0";
            
        } else if (comboCount >= (htCount + brickCount)) {
            // LA TUA REGOLA: Combo >= (HT + Bricks) -> Almeno il 50% del deck
            verdictTitle.innerText = "🥇 Da Primo (Combo/Aggro)";
            verdictDesc.innerText = "Oltre il 50% del mazzo è Combo. Consistenza devastante per dominare il turno 1!";
            verdictTitle.className = "text-success fw-bold m-0";
            
        } else if (diffComboHt <= 2 && brickCount <= 15) { 
            // BILANCIATO: Differenza minima tra Combo e HT (max 2), senza troppi brick
            verdictTitle.innerText = "⚖️ Bilanciato (Midrange)";
            verdictDesc.innerText = "Equilibrio perfetto tra partenze stabili e interruzioni nel turno avversario.";
            verdictTitle.className = "text-info fw-bold m-0";
            
        } else if (htCount > comboCount) {
            // GOING 2ND: Più Hand Traps che Combo
            verdictTitle.innerText = "🥈 Da Secondo (Going 2nd)";
            verdictDesc.innerText = "Eccellente capacità di interrompere l'avversario e spezzare le board.";
            verdictTitle.className = "text-warning text-dark fw-bold m-0";
            
        } else {
            // CASO IBRIDO: Più Combo che HT, ma non raggiunge il 50% assoluto del mazzo
            verdictTitle.innerText = "🤔 Orientato al Primo (Ibrido)";
            verdictDesc.innerText = "Buona base per scombare, ma ratio migliorabili per massimizzare il topdeck.";
            verdictTitle.className = "text-light fw-bold m-0";
        }
    }
};