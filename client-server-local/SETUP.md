# Installation & Running Guide

This guide covers how to set up, run, test, and build the **client-server-local** Fibonacci calculator application locally using Docker Compose (or directly with Node.js).

For an overview of the architecture and API endpoints, see [README.md](./README.md).

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
cd /path/to/docker-k8s/client-server-local
```

You do **not** need to run `npm install` manually on your host machine when running via Docker Compose—each Node.js service installs its own dependencies inside its container image and preserves them using an anonymous `/app/node_modules` volume.

---

## 3. Running in Development Mode (Docker Compose)

### Start All Services

Build the development images and launch both containers (`client`, `api`):

```bash
docker compose up --build
```

To run the containers in the background (detached mode):

```bash
docker compose up --build -d
```

> **First run:** Docker will download the base image (`node:lts-alpine`) and install npm packages for `client` and `server`, which may take a minute. Subsequent starts are fast thanks to Docker layer caching.

### Access the Application

Once both containers are up:

- **Web App (React UI):** [http://localhost:3000](http://localhost:3000)
- **Secondary SPA Route:** [http://localhost:3000/otherpage](http://localhost:3000/otherpage)
- **API Health Check:** [http://localhost:5000/](http://localhost:5000/) (returns `Hi`)
- **Submitted Indexes & Calculated Values:** [http://localhost:5000/values](http://localhost:5000/values)

### Try It Out

1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. Enter a Fibonacci index (any integer from `0` to `40`, e.g., `7`) and click **Calculate**.
3. The browser sends a direct cross-origin (`CORS`) request to `http://localhost:5000/values`. The Express server calculates `fib(index)` and stores the result in memory:
   - **Indexes I have seen** displays all submitted indexes from the server's in-memory array (`seenIndexes`).
   - **Calculated Values** displays the computed Fibonacci values from the server's in-memory object (`calculatedValues`).

> **Note:** Because data is stored in memory inside the `api` container, submitted indexes and calculated values reset whenever the `api` container restarts (including `nodemon` auto-restarts during development).

### Live Reloading During Development

Source folders are bind-mounted into their containers in `docker-compose.yml`:

- **`./client`** -> Vite Dev Server with WebSocket Hot Module Replacement directly on `:3000`.
- **`./server`** -> Auto-restarts on file edits via `nodemon` on `:5000`.

---

## 4. Managing Containers & Logs

```bash
# View running containers and port mappings
docker compose ps

# Follow combined logs from both services
docker compose logs -f

# Follow logs for a specific service (client or api)
docker compose logs -f api

# Stop and remove containers and the default network
docker compose down

# Stop, remove containers, AND wipe anonymous volumes (rebuilds node_modules on next start)
docker compose down -v
```

---

## 5. Running Tests

### Option A: Run Client Tests via Docker

```bash
docker build -t cs-client-test -f ./client/Dockerfile.dev ./client
docker run cs-client-test npm test
```

### Option B: Run Client Tests Locally (Requires Node.js)

```bash
cd client
npm install
npm test
```

---

## 6. Building Production Images

Each service includes a production `Dockerfile` (with a multi-stage Node -> Nginx build for `client`):

```bash
docker build -t cs-client --build-arg VITE_API_URL=http://localhost:5000 ./client
docker build -t cs-server ./server
```

Run them locally:

```bash
docker run -d --name cs-server -p 5000:5000 cs-server
docker run -d --name cs-client -p 3000:3000 cs-client
```

| Service | Production Dockerfile | Runtime Behavior |
| :--- | :--- | :--- |
| **`client`** | `./client/Dockerfile` | Stage 1 builds static Vite/React bundle (`/app/dist`) with `VITE_API_URL`; Stage 2 serves it via Nginx on port `3000` with SPA `try_files` fallback |
| **`server`** | `./server/Dockerfile` | Runs `node index.js` (Express on port `5000`, CORS enabled, in-memory storage & `fib()` calculation) |

---

## 7. Ports & Environment Reference

| Service | Host Port | Container Port | Notes |
| :--- | :--- | :--- | :--- |
| `client` | `3000` | `3000` | Exposed directly to host |
| `api` | `5000` | `5000` | Exposed directly to host (CORS enabled) |

| Variable | Service | Default | Description |
| :--- | :--- | :--- | :--- |
| `VITE_API_URL` | `client` | `http://localhost:5000` | Base URL the browser uses to call the Express API |

---

## 8. Troubleshooting

- **Port `3000` or `5000` is already in use:** Change the host port mapping in `docker-compose.yml` (for example, `'5001:5000'` for `api` and update `VITE_API_URL=http://localhost:5001` on `client`), then restart with `docker compose up`.
- **Added a new package to `package.json`, but container can't find it:** Because `/app/node_modules` is preserved as an anonymous volume, rebuild and recreate volumes with:
  ```bash
  docker compose down -v
  docker compose up --build
  ```
- **API returns `422 Index too high`:** By design, `server/index.js` rejects any index `> 40` to protect the Node.js event loop from slow exponential `O(2^n)` recursion.
- **Submitted values disappeared:** Data is stored in memory on the `api` server and resets whenever `server/index.js` restarts (such as after editing server files or restarting the container).
