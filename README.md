# FlatClean – WG-Putzplan App

FlatClean ist eine kleine App für eure WG, um Putzaufgaben zu rotieren, Punkte zu vergeben und die Historie zu sehen.  
Sie besteht aus einer FastAPI‑Backend‑API und einem statischen Frontend (`index.html`, `app.js`, `base.css`, `style.css`).

## Voraussetzungen

- Python 3.10 oder neuer
- `pip` (Python Paketmanager)

## Installation (Backend)

Im Projektordner im Terminal:

```bash
cd /Users/giacomolanda/Desktop/FlatClean
pip install -r requirements.txt
```

Dann das FastAPI‑Backend starten:

```bash
python api_server.py
```

Das Backend läuft standardmäßig auf Port `8000` (`http://localhost:8000`) und legt eine SQLite‑Datenbank `flatclean.db` im Projektordner an.

## Frontend lokal starten

Am einfachsten startest du einen kleinen HTTP‑Server aus dem Projektordner:

```bash
cd /Users/giacomolanda/Desktop/FlatClean
python -m http.server 5173
```

Dann im Browser öffnen:

- Am Mac: `http://localhost:5173/index.html`
- Am iPhone (im gleichen WLAN): `http://DEINE-IP-ADRESSE:5173/index.html`

Das Frontend verbindet sich automatisch mit:

- `http://localhost:8000`, wenn du es auf dem Mac öffnest, oder
- mit der URL aus dem `api`‑Query‑Parameter, z.B.:

```text
http://DEINE-IP-ADRESSE:5173/index.html?api=http://DEINE-IP-ADRESSE:8000
```

Damit dein iPhone das Backend erreicht, muss das Backend mit `host="0.0.0.0"` laufen (ist in `api_server.py` bereits so konfiguriert) und Mac + iPhone müssen im selben Netzwerk sein.

**Alternative (einfacher):**  
`api_server.py` kann jetzt auch direkt die statischen Dateien (`index.html`, `app.js`, CSS) ausliefern.  
Dann reicht es lokal, nur das Backend zu starten und im Browser aufzurufen:

```text
http://localhost:8000/
```

## Datenbank

- Die SQLite‑Datei liegt im Projektordner als `flatclean.db`.
- Du kannst sie einfach löschen, wenn du komplett neu starten willst (alle Personen/Aufgaben/History gehen dann verloren).

## Deployment (unabhängig von deinem Computer)

Damit die App auch läuft, wenn dein Mac aus ist, kannst du sie z.B. als Docker‑Container auf einem kleinen Server oder Dienst wie Render/Fly/Railway laufen lassen.

### 1. Docker‑Image lokal bauen

Im Projektordner:

```bash
cd /Users/giacomolanda/Desktop/FlatClean
docker build -t flatclean .
```

Lokal testen:

```bash
docker run --rm -p 8000:8000 flatclean
```

Dann im Browser/auf dem iPhone:

```text
http://DEINE-IP:8000/
```

### 2. Beispiel: Deployment mit Render (vereinfacht)

1. Code in ein Git‑Repository pushen (z.B. GitHub).  
2. Bei Render einen neuen **Web Service** erstellen:
   - Repository auswählen
   - Runtime: **Docker**
   - Exposed Port: `8000`
3. Render baut das Docker‑Image anhand der `Dockerfile` und startet den Container.
4. Du bekommst eine URL, z.B. `https://flatclean.onrender.com`.

Ab dann:

- Eure WG nutzt einfach `https://flatclean.onrender.com` auf dem Handy.  
- Kein Mac mehr nötig, der laufen muss.

Andere Anbieter (Fly.io, Railway, eigener vServer) funktionieren ähnlich:  
Du baust bzw. lässt ein Image bauen und startest es mit `uvicorn api_server:app --host 0.0.0.0 --port 8000`.

## Nächste Schritte

- Oberfläche und Texte auf Deutsch bringen
- UX für iPhone optimieren (PWA‑Manifest, Homescreen‑Icon)
- WG‑Regeln & Punkte‑Logik nach euren Wünschen anpassen

