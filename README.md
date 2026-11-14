# Obediência · Desobediência

Contadores diários públicos (mobile-first) de **obediência e respeito** e **desobediência e desrespeito**, com histórico em gráfico. Os números são compartilhados entre qualquer device que abrir a página.

- Produção: [https://obediencia.hurast.com](https://obediencia.hurast.com)
- Fuso do “dia”: `America/Sao_Paulo`
- Sem login — leitura e escrita abertas

## Stack

- Front: HTML / CSS / JS (vanilla) + Chart.js
- API: Node.js (HTTP nativo) + SQLite (`better-sqlite3`)
- Deploy: nginx + Let’s Encrypt + PM2 no mesmo VPS do Pokemon, **isolado** (pasta, porta, site e processo próprios)

## Desenvolvimento local

```bash
npm install
npm run dev
```

Abra [http://127.0.0.1:8790](http://127.0.0.1:8790).

Variáveis opcionais:

| Variável | Default | Descrição |
|---|---|---|
| `OBEDIENCIA_PORT` | `8790` | Porta da API |
| `OBEDIENCIA_HOST` | `127.0.0.1` | Bind (use `0.0.0.0` se precisar expor na LAN) |
| `RATE_LIMIT_POR_MINUTO` | `60` | Limite soft por IP |

## API

- `GET /api/hoje` → contadores do dia corrente
- `POST /api/evento` `{ "tipo": "obediencia"|"desobediencia", "delta": 1|-1 }`
- `GET /api/historico?dias=30` → série diária para o gráfico
- `GET /api/saude` → healthcheck

Valores nunca ficam negativos.

## Deploy no VPS (obediencia.hurast.com)

Espelha o fluxo do Pokemon, **sem alterar** `/var/www/pokemon-ai`, ports `8787/8788` nem o nginx do jogo.

### 1. DNS

Crie um registro **A** (e AAAA se houver IPv6) para `obediencia.hurast.com` apontando para o **mesmo IP** do VPS.

### 2. Repo no servidor

Garanta que o repositório remoto existe e que `deploy/install.sh` aponta para ele (`REPO=...`). Default:

`git@github.com:huras/obediencia-desobediencia.git`

### 3. Instalar / atualizar

No VPS:

```bash
# primeira vez ou update
bash /var/www/obediencia/deploy/install.sh main

# se os arquivos já foram copiados sem git:
# SKIP_GIT=1 bash deploy/install.sh
```

O script:

1. Clona/atualiza em `/var/www/obediencia`
2. `npm install --omit=dev`
3. Instala **somente** o site nginx `obediencia.hurast.com`
4. Emite certificado Let’s Encrypt se ainda não existir
5. Sobe/reinicia **apenas** o PM2 `obediencia-api` na porta `8790`

### 4. Conferir

```bash
pm2 status
curl -s https://obediencia.hurast.com/api/saude
# Pokemon continua intacto:
pm2 describe pokemon-ai-mmo
```

## Estrutura

```
public/          # front estático
server/          # API + SQLite
deploy/          # nginx, PM2, install.sh
```
