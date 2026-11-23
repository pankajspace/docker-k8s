# Client-Server-Nginx Local Architecture

A simplified 3-container version of the Fibonacci calculator application using only **Nginx**, **React Client**, and **Express API Server**.

PostgreSQL, Redis, and the separate background worker service have been removed:
- **Storage**: Replaced with simple in-memory JavaScript data structures (`seenIndexes` array and `calculatedValues` object) inside `server/index.js`.
- **Calculation**: The recursive `fib(index)` worker function runs directly inside the Express server.

> Note: Because data is stored in server memory, submitted indexes and calculated values reset when the `api` container restarts.

## Architecture

### Simple Overview

```mermaid
flowchart LR
    User(["Browser / User"])

    subgraph Docker["Docker Network (docker-compose)"]
        Nginx["Nginx Reverse Proxy\n(Host :3050 -> :80)"]
        Client["React Client (:3000)\nDev: Vite Dev Server\nProd: Nginx (static SPA)"]
        API["Express API Server\n(:5000)\nIn-Memory Data + fib()"]
    end

    User -->|"HTTP / WS :3050"| Nginx
    Nginx -->|"/"| Client
    Nginx -->|"/api/*"| API
```

### Detailed Architecture

```mermaid
flowchart TB
    subgraph Host["Host Machine"]
        Browser(["Browser\nhttp://localhost:3050"])
        HostClientSrc["./client\n(Dev Bind Mount)"]
        HostServerSrc["./server\n(Dev Bind Mount)"]
    end

    subgraph DockerNet["Docker Bridge Network (docker-compose embedded DNS)"]
        subgraph NginxSvc["nginx Container (nginx:alpine | Host :3050 -> :80)"]
            NginxListen["listen 80\n(nginx/default.conf)"]
            LocRoot["location /\nHTTP/1.1 + WS Upgrade\nproxy_pass http://client"]
            LocApi["location /api\nrewrite /api/(.*) /$1 break\nproxy_pass http://api"]
            NginxListen --> LocRoot
            NginxListen --> LocApi
        end

        subgraph ClientSvc["client Container (Internal :3000)"]
            ClientDev["Dev Mode (Dockerfile.dev)\nVite Dev Server :3000 + HMR\n(node:lts-alpine)"]
            ClientProd["Prod Mode (Dockerfile)\nNginx :3000 (client/nginx/default.conf)\ntry_files $uri $uri/ /index.html"]
            ReactSPA["React 18 SPA (runs in Browser)\nApp.jsx + React Router\n'/' -> Fib.jsx | '/otherpage' -> OtherPage.jsx"]
            ClientDev -.->|"serves bundle & HMR"| ReactSPA
            ClientProd -.->|"serves /app/dist static assets"| ReactSPA
        end

        subgraph ApiSvc["api Container (Internal :5000)"]
            ApiRuntime["Node.js Runtime\nDev: nodemon | Prod: node index.js"]
            ExpressApp["Express Server :5000\ncors() + express.json()"]
            Routes["Routes (after /api strip)\nGET / | GET /values | POST /values"]
            Validate["Validate 0 <= index <= 40\n(422 on invalid/too high)"]
            FibCalc["fib(index)\nRecursive O(2^n) Calculator"]
            MemStore[("In-Memory Store (volatile)\nseenIndexes: number[]\ncalculatedValues: { index: value }")]

            ApiRuntime --> ExpressApp --> Routes
            Routes -->|"POST /values"| Validate
            Validate -->|"valid"| FibCalc
            FibCalc -->|"cache miss -> compute & save"| MemStore
            Routes <-->|"GET /values"| MemStore
        end
    end

    Browser -->|"HTTP / WebSocket :3050"| NginxListen
    LocRoot -->|"client:3000"| ClientDev
    LocRoot -.->|"prod: client:3000"| ClientProd
    LocApi -->|"api:5000"| ExpressApp
    ReactSPA -->|"fetch('/api/values')\nGET & POST JSON"| NginxListen

    HostClientSrc -.->|"bind mount -> /app\n(+ anon vol /app/node_modules)"| ClientDev
    HostServerSrc -.->|"bind mount -> /app\n(+ anon vol /app/node_modules)"| ApiRuntime
```

| Service | Container Role | Tech Stack | Internal Port |
| :--- | :--- | :--- | :--- |
| **`nginx`** | Single entry point & HTTP/WS reverse proxy | Nginx (`nginx/default.conf`) | `80` (Host `3050`) |
| **`client`** | Single-Page Application (SPA) UI (Vite dev server in dev; Nginx serving static bundle in prod) | React 18, Vite, React Router, Nginx (prod) | `3000` |
| **`api`** | REST API, Fibonacci calculator, and in-memory storage | Node.js, Express | `5000` |

### Nginx Inside `client` (Development vs. Production)

This project has **two** separate Nginx configurations with different responsibilities:

- **Outer reverse proxy ([`nginx/default.conf`](./nginx/default.conf))**: Runs in the `nginx` container on port `80` (mapped to host `3050`) and routes `/` to `client:3000` and `/api/*` to `api:5000`.
- **Client container Nginx ([`client/nginx/default.conf`](./client/nginx/default.conf))**: Used **only in production** ([`client/Dockerfile`](./client/Dockerfile)). A multi-stage build compiles the React app with Vite into static assets (`/app/dist`), then serves them with Nginx on port `3000` (matching the outer proxy's `client:3000` upstream) using `try_files $uri $uri/ /index.html` so React Router paths like `/otherpage` work on page refresh.
- **In local development** ([`docker-compose.yml`](./docker-compose.yml) / [`client/Dockerfile.dev`](./client/Dockerfile.dev)): The `client` container does **not** run Nginx—it runs the **Vite dev server** on port `3000` for live reloading and Hot Module Replacement.

## Service Architecture Diagrams

### 1. Nginx Reverse Proxy Service (`nginx`)

Single public entry point built from `nginx:alpine` ([`nginx/Dockerfile.dev`](./nginx/Dockerfile.dev) / [`nginx/Dockerfile`](./nginx/Dockerfile)) with custom routing in [`nginx/default.conf`](./nginx/default.conf).

```mermaid
flowchart LR
    Browser(["Browser / Client\nhttp://localhost:3050"])

    subgraph NginxContainer["nginx Container (nginx:alpine | restart: always | depends_on: api, client)"]
        PortMap["Port Mapping\nHost :3050 -> Container :80"]
        ServerBlock["server { listen 80; }\n/etc/nginx/conf.d/default.conf"]

        subgraph FrontendRoute["location /"]
            WSHeaders["proxy_http_version 1.1\nUpgrade: $http_upgrade\nConnection: Upgrade\nHost: $http_host"]
            UpstreamClient["upstream client\nserver client:3000"]
            WSHeaders --> UpstreamClient
        end

        subgraph ApiRoute["location /api"]
            Rewrite["rewrite /api/(.*) /$1 break\n(strips '/api' prefix)"]
            UpstreamApi["upstream api\nserver api:5000"]
            Rewrite --> UpstreamApi
        end

        PortMap --> ServerBlock
        ServerBlock -->|"Pages, Assets, Vite HMR WS"| WSHeaders
        ServerBlock -->|"/api/* REST calls"| Rewrite
    end

    ClientTarget["client:3000\n(React / Vite or Prod Nginx)"]
    ApiTarget["api:5000\n(Express API Server)"]

    Browser -->|"Same-origin HTTP / WS"| PortMap
    UpstreamClient -->|"HTTP / WS"| ClientTarget
    UpstreamApi -->|"HTTP (rewritten path)"| ApiTarget
```

### 2. React Client Service (`client`)

Serves the React 18 SPA on internal port `3000`, using Vite in development ([`client/Dockerfile.dev`](./client/Dockerfile.dev)) and a multi-stage Nginx build in production ([`client/Dockerfile`](./client/Dockerfile)).

```mermaid
flowchart TB
    OuterNginx["Outer Nginx Proxy\n(client:3000)"]

    subgraph DevFlow["Development Mode (docker-compose.yml / client/Dockerfile.dev)"]
        HostSrc["Host ./client"] -.->|"bind mount -> /app"| ViteDev
        AnonVol["Anonymous Volume\n/app/node_modules"] -.->|"preserves deps"| ViteDev
        ViteDev["Vite Dev Server (:3000)\nnode:lts-alpine | npm run start\nLive Reload + HMR WebSocket"]
    end

    subgraph ProdFlow["Production Mode (client/Dockerfile Multi-Stage Build)"]
        Stage1["Stage 1: builder (node:lts-alpine)\nnpm ci -> npm run build\nOutputs /app/dist"]
        Stage2["Stage 2: runtime (nginx:alpine :3000)\nclient/nginx/default.conf\nroot /usr/share/nginx/html\ntry_files $uri $uri/ /index.html"]
        Stage1 -->|"COPY --from=builder /app/dist"| Stage2
    end

    subgraph BrowserSPA["React 18 SPA (Executed in Browser)"]
        IndexEntry["src/index.jsx -> App.jsx\nBrowserRouter + Navbar"]
        RouteFib["Route '/'\nFib.jsx\nState: seenIndexes, values, index, error"]
        RouteOther["Route '/otherpage'\nOtherPage.jsx\nVerifies SPA routing & try_files"]
        ApiCalls["Fetch Client\nGET /api/values (mount & Refresh)\nPOST /api/values (form submit)"]

        IndexEntry --> RouteFib
        IndexEntry --> RouteOther
        RouteFib --> ApiCalls
    end

    OuterNginx -->|"Dev traffic + WS"| ViteDev
    OuterNginx -.->|"Prod traffic"| Stage2
    ViteDev -->|"ESM modules & HMR"| IndexEntry
    Stage2 -.->|"Static HTML/JS/CSS"| IndexEntry
    ApiCalls -->|"HTTP JSON via Outer Nginx"| OuterNginx
```

### 3. Express API Service (`api`)

Node.js Express server listening on internal port `5000` ([`server/index.js`](./server/index.js)), combining REST endpoints, synchronous recursive Fibonacci computation, and volatile in-memory storage.

```mermaid
flowchart TB
    OuterNginx["Outer Nginx Proxy\n(api:5000, '/api' stripped)"]

    subgraph ApiContainer["api Container (node:lts-alpine | Internal :5000)"]
        subgraph Modes["Container Startup"]
            DevMode["Dev (server/Dockerfile.dev)\nnpm ci -> nodemon\n./server:/app + /app/node_modules"]
            ProdMode["Prod (server/Dockerfile)\nnpm ci --omit=dev -> node index.js"]
        end

        subgraph Middleware["Express Middleware (server/index.js)"]
            CORS["cors()"]
            JsonParser["express.json()"]
            CORS --> JsonParser
        end

        subgraph Handlers["Route Handlers"]
            GetRoot["GET /\nReturns 'Hi' (health check)"]
            GetValues["GET /values\nReturns { seenIndexes, calculatedValues }"]
            PostValues["POST /values\nBody: { index }"]
        end

        subgraph ValidationAndCalc["POST /values Processing"]
            ParseCheck{"parseInt(index, 10)\nvalid & >= 0 & <= 40?"}
            Err422["HTTP 422\n'Invalid index' or 'Index too high'"]
            RecordIdx["seenIndexes.push(parsedIndex)"]
            CacheCheck{"calculatedValues[key]\nalready cached?"}
            ComputeFib["fib(parsedIndex)\nRecursive O(2^n) calculation\ncalculatedValues[key] = result"]
            SendResp["HTTP 200 JSON\n{ seenIndexes, calculatedValues }"]

            ParseCheck -->|"No"| Err422
            ParseCheck -->|"Yes"| RecordIdx --> CacheCheck
            CacheCheck -->|"No (miss)"| ComputeFib --> SendResp
            CacheCheck -->|"Yes (hit)"| SendResp
        end

        MemData[("In-Memory Data\nseenIndexes: [7, ...]\ncalculatedValues: { '7': 21, ... }\n(resets on container restart)")]

        DevMode -.-> CORS
        ProdMode -.-> CORS
        JsonParser --> GetRoot
        JsonParser --> GetValues
        JsonParser --> PostValues
        PostValues --> ParseCheck
        GetValues <-->|"read"| MemData
        RecordIdx -->|"append"| MemData
        CacheCheck -.->|"lookup"| MemData
        ComputeFib -->|"write"| MemData
    end

    OuterNginx -->|"HTTP :5000"| CORS
```

## Quick Start

For full installation, testing, production build, and troubleshooting instructions, see [SETUP.md](./SETUP.md).

```bash
cd client-server-nginx-local
docker compose up --build
```

Then open [http://localhost:3050](http://localhost:3050).

## API Endpoints

All API requests are routed by Nginx from `/api/*` to the Express server (stripping the `/api` prefix):

- `GET /api/` — Health check (`"Hi"`)
- `GET /api/values` — Returns `{ seenIndexes: [7, ...], calculatedValues: { "7": 21, ... } }`
- `POST /api/values` — Body `{ "index": "7" }`. Validates `0 <= index <= 40`, computes `fib(index)`, stores it in memory, and returns the updated `{ seenIndexes, calculatedValues }`.
