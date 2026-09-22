# Usa un'immagine ufficiale di Python leggera e compatibile con tutti i sistemi
FROM python:3.11-slim

# Imposta la cartella di lavoro all'interno del container
WORKDIR /app

# Copia il file dei requisiti e installa le librerie
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia tutto il resto del codice sorgente nel container
COPY . .

# Espone la porta 5000 di Flask
EXPOSE 5000

# Avvia l'applicazione
CMD ["python", "app.py"]