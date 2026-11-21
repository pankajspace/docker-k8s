# Installation & Running Guide

This guide covers how to set up, run, test, and build the **multi-container-services** Fibonacci calculator application locally using Docker Compose.

For a detailed breakdown of the system design and diagrams, see [README.md](./README.md).

---

## 1. Prerequisites

Install the following before getting started:

- **Docker** (Docker Desktop on macOS/Windows, or Docker Engine on Linux)
- **Docker Compose** (included with Docker Desktop via `docker compose`, or standalone `docker-compose`)
- **Git** (optional, if cloning the repository)

Verify your installation:

```bash
docker --version
docker compose version
```

> **Note (Linux users):** Ensure the Docker daemon is running (`sudo systemctl start docker`) and that your user is in the `docker` group (or prefix commands with `sudo`).

---

## 2. Project Setup

Navigate into the project directory:

```bash
cd /path/to/docker-k8s/multi-container-services
```

You do **not** need to run `npm install` manually on your host machine when running via Docker Compose—each service installs its own Node.js dependencies inside its container image and preserves them using an anonymous `/app/node_modules` volume.

---

## 3. Running in Development Mode (Docker Compose)

### Start All Services

Build the development images and launch all 6 containers (`nginx`, `client`, `api`, `worker`, `redis`, `postgres`):

```bash
docker compose up --build
```

To run the containers in the background (detached mode):

```bash
docker compose up --build -d
```

> **First run:** Docker will download base images (`postgres:latest`, `redis:latest`, `nginx`, `node:lts-alpine`) and install npm packages for `client`, `server`, and `worker`, which may take a couple of minutes. Subsequent starts are fast thanks to Docker layer caching.

### Access the Application

Once all containers are up:

- **Web App (React UI):** [http://localhost:3050](http://localhost:3050)
- **Secondary SPA Route:** [http://localhost:3050/otherpage](http://localhost:3050/otherpage)
- **API Health Check:** [http://localhost:3050/api/](http://localhost:3050/api/) (returns `Hi`)
- **Historical Indexes (PostgreSQL):** [http://localhost:3050/api/values/all](http://localhost:3050/api/values/all)
- **Calculated Values (Redis):** [http://localhost:3050/api/values/current](http://localhost:3050/api/values/current)

### Try It Out

1. Open [http://localhost:3050](http://localhost:3050) in your browser.
2. Enter a Fibonacci index (any integer `<= 40`, e.g., `7`) and click **Submit**.
3. Refresh the page:
   - **Indexes I have seen** displays the submitted index retrieved from **PostgreSQL**.
   - **Calculated Values** displays the Fibonacci result computed asynchronously by the **Worker** and stored in **Redis**.

> **Why refresh?** `Fib.js` fetches `/api/values/all` and `/api/values/current` on initial component mount, and `POST /api/values` returns `{ working: true }` immediately while the worker computes the value in the background.

### Live Reloading During Development

Source folders are bind-mounted into their containers in `docker-compose.yml`:

- **`./client`** -> React Dev Server with WebSocket Hot Module Replacement (`/ws`, `WDS_SOCKET_PORT=0`).
- **`./server`** -> Auto-restarts on file edits via `nodemon`.
- **`./worker`** -> Auto-restarts on file edits via `nodemon`.

---

## 4. Managing Containers & Logs

```bash
# View running containers and port mappings
docker compose ps

# Follow combined logs from all services
docker compose logs -f

# Follow logs for a specific service (nginx, client, api, worker, redis, postgres)
docker compose logs -f api worker

# Stop and remove containers and the default network
docker compose down

# Stop, remove containers, AND wipe anonymous volumes (resets Postgres/Redis data & node_modules)
docker compose down -v
```

---

## 5. Running Tests

### Option A: Run Client Tests via Docker (Matches CI Pipeline)

This mirrors `../.github/workflows/multi-container-services-deploy.yaml`:

```bash
docker build -t multi-client-test -f ./client/Dockerfile.dev ./client
docker run -e CI=true multi-client-test npm test
```

### Option B: Run Client Tests Locally (Requires Node.js)

```bash
cd client
npm install
CI=true npm test
```

---

## 6. Building Production Images

Each custom service includes a production `Dockerfile` (with a multi-stage Node -> Nginx build for `client`):

```bash
docker build -t multi-client ./client
docker build -t multi-nginx ./nginx
docker build -t multi-server ./server
docker build -t multi-worker ./worker
```

| Service | Production Dockerfile | Runtime Behavior |
| :--- | :--- | :--- |
| **`client`** | `./client/Dockerfile` | Stage 1 builds static React bundle; Stage 2 serves `/app/build` via Nginx on port `3000` with SPA `try_files` fallback |
| **`nginx`** | `./nginx/Dockerfile` | Nginx reverse proxy routing `/`, `/ws`, and `/api/*` |
| **`server`** | `./server/Dockerfile` | Runs `node index.js` (Express on port `5000`) |
| **`worker`** | `./worker/Dockerfile` | Runs `node index.js` (Redis `"insert"` subscriber) |

---

## 7. Ports & Environment Variables Reference

### Ports

| Service | Host Port | Container Port | Notes |
| :--- | :--- | :--- | :--- |
| `nginx` | `3050` | `80` | Only port exposed to the host |
| `client` | — | `3000` | Internal Docker network only |
| `api` | — | `5000` | Internal Docker network only |
| `redis` | — | `6379` | Internal Docker network only |
| `postgres` | — | `5432` | Internal Docker network only |

### Environment Variables (`docker-compose.yml`)

| Variable | Default (Dev) | Used By | Purpose |
| :--- | :--- | :--- | :--- |
| `POSTGRES_PASSWORD` | `postgres_password` | `postgres` | Postgres superuser password |
| `PGUSER` | `postgres` | `api` | Postgres username |
| `PGHOST` | `postgres` | `api` | Postgres Docker service hostname |
| `PGDATABASE` | `postgres` | `api` | Postgres database name |
| `PGPASSWORD` | `postgres_password` | `api` | Postgres password |
| `PGPORT` | `5432` | `api` | Postgres internal port |
| `REDIS_HOST` | `redis` | `api`, `worker` | Redis Docker service hostname |
| `REDIS_PORT` | `6379` | `api`, `worker` | Redis internal port |
| `WDS_SOCKET_PORT` | `0` | `client` | Enables Webpack Dev Server WebSocket HMR through Nginx (`:3050`) |

---

## 8. Troubleshooting

- **Port `3050` is already in use:** Change `'3050:80'` in `docker-compose.yml` (e.g., to `'3051:80'`) and restart with `docker compose up`.
- **Added a new package to `package.json`, but container can't find it:** Because `/app/node_modules` is preserved as an anonymous volume, rebuild and recreate volumes with:
  ```bash
  docker compose down -v
  docker compose up --build
  ```
- **API returns `422 Index too high`:** By design, `server/index.js` rejects any index `> 40` to protect the worker from exponential `O(2^n)` recursion.
- **Value shows `Nothing yet!`:** Either the worker is still computing a large index (e.g., `38–40`) or has not finished connecting to Redis yet. Wait a few seconds and refresh, or check `docker compose logs -f worker`.
- **`postgres` or `redis` connection errors right at startup:** Both `api` and `worker` use a 1000ms Redis reconnect strategy, and `nginx` uses `restart: always`. Give containers a few seconds to finish booting; if `api` failed before Postgres initialized, restart it with `docker compose restart api`.
