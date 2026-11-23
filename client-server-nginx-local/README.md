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
        Client["React Client (:3000)\nVite Dev Server"]
        API["Express API Server\n(:5000)\nIn-Memory Data + fib()"]
    end

    User -->|"HTTP / WS :3050"| Nginx
    Nginx -->|"/"| Client
    Nginx -->|"/api/*"| API
```

### Detailed Architecture (Request & Data Flow)

```mermaid
flowchart TB
    Browser(["Browser\nhttp://localhost:3050"])

    subgraph NginxSvc["nginx Reverse Proxy (:3050 -> :80)"]
        NginxEntry["HTTP / WS Listener (:80)"]
        LocRoot["location /\nHTTP/1.1 + WS Upgrade Headers"]
        LocApi["location /api\nrewrite /api/(.*) /$1 break"]
        NginxEntry -->|"Page, Assets, HMR WS"| LocRoot
        NginxEntry -->|"/api/* REST requests"| LocApi
    end

    subgraph ClientSvc["client Service (:3000)"]
        ClientServer["Vite Dev Server (:3000)\nServes SPA bundle + HMR WebSocket"]
        ReactSPA["React 18 SPA (runs in Browser)\nApp.jsx -> '/' Fib.jsx | '/otherpage' OtherPage.jsx"]
        ClientServer -->|"HTML / JS / CSS + HMR"| ReactSPA
    end

    subgraph ApiSvc["api Service (:5000)"]
        Middleware["Express Middleware\ncors() -> express.json()"]
        GetRoot["GET /\nReturns 'Hi'"]
        GetValues["GET /values\nReads current state"]
        PostValues["POST /values ({ index })\nValidates 0 <= index <= 40"]
        Err422["HTTP 422\n'Invalid index' / 'Index too high'"]
        FibCalc["Cache check -> fib(index)\nComputes on cache miss"]
        MemStore[("In-Memory Store\nseenIndexes: [7, ...]\ncalculatedValues: { '7': 21, ... }")]

        Middleware --> GetRoot
        Middleware --> GetValues
        Middleware --> PostValues
        PostValues -->|"invalid / > 40"| Err422
        PostValues -->|"valid"| FibCalc
        FibCalc -->|"push index & save value"| MemStore
        GetValues <-->|"read state"| MemStore
        FibCalc -->|"updated state"| GetValues
    end

    Browser -->|"1. GET / or /otherpage"| NginxEntry
    LocRoot -->|"2. Forward to client:3000"| ClientServer
    ReactSPA -->|"3. GET /api/values (mount / refresh)\n4. POST /api/values { index } (submit)"| NginxEntry
    LocApi -->|"5. Forward / or /values to api:5000"| Middleware
    GetValues -.->|"6. JSON { seenIndexes, calculatedValues }"| Browser
    Err422 -.->|"Error message"| Browser
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

Acts as the single entry point ([`nginx/default.conf`](./nginx/default.conf)), routing frontend and WebSocket traffic to `client:3000` and rewriting `/api/*` requests to `api:5000`.

```mermaid
flowchart LR
    Browser(["Browser\nhttp://localhost:3050"])

    subgraph NginxSvc["nginx (:3050 -> :80)"]
        ServerBlock["server { listen 80; }"]

        subgraph FrontendRoute["location /"]
            WSHeaders["Preserve Host + HTTP/1.1\nUpgrade & Connection: Upgrade"]
            UpstreamClient["proxy_pass http://client"]
            WSHeaders --> UpstreamClient
        end

        subgraph ApiRoute["location /api"]
            Rewrite["rewrite /api/(.*) /$1 break\n(e.g. /api/values -> /values)"]
            UpstreamApi["proxy_pass http://api"]
            Rewrite --> UpstreamApi
        end

        ServerBlock -->|"GET /, /otherpage, assets, WS"| WSHeaders
        ServerBlock -->|"GET/POST /api/*"| Rewrite
    end

    ClientTarget["client (:3000)\nVite Dev Server"]
    ApiTarget["api (:5000)\nExpress API Server"]

    Browser -->|"HTTP / WS requests"| ServerBlock
    UpstreamClient -->|"Forwarded frontend / WS"| ClientTarget
    ClientTarget -.->|"HTML / JS / CSS / WS"| Browser
    UpstreamApi -->|"Rewritten API request"| ApiTarget
    ApiTarget -.->|"JSON / HTTP 422 response"| Browser
```

### 2. React Client Service (`client`)

Serves the React 18 SPA on `:3000` and manages client-side routing, UI state, and API communication with `api` through `nginx`.

```mermaid
flowchart TB
    OuterNginx["nginx Reverse Proxy\n(routes '/' -> client:3000)"]

    subgraph ClientServer["client Service (:3000)"]
        ViteDev["Vite Dev Server (:3000)\nServes index.html, ESM modules & HMR WebSocket"]
    end

    subgraph BrowserSPA["React 18 SPA (Browser Runtime)"]
        Router["App.jsx (BrowserRouter)\nNavbar: Calculator ('/') | Other Page ('/otherpage')"]
        OtherPage["OtherPage.jsx ('/otherpage')\nStatic view + link back to '/'"]

        subgraph FibView["Fib.jsx ('/')"]
            UIState["React State\nseenIndexes[] | values{} | index | error"]
            MountOrRefresh["useEffect (mount) / Refresh button"]
            FormSubmit["Form Submit (index: 0..40)"]
            RenderUI["UI Render\nIndexes I have seen (chips)\nCalculated Values (sorted grid)\nError Alert Banner"]

            MountOrRefresh -->|"GET /api/values"| ApiFetch["fetch() to Same-Origin /api/*"]
            FormSubmit -->|"POST /api/values\n{ index }"| ApiFetch
            ApiFetch -.->|"200 JSON -> applyServerData()"| UIState
            ApiFetch -.->|"422 / error -> setError()"| UIState
            UIState --> RenderUI
        end

        Router -->|"/"| FibView
        Router -->|"/otherpage"| OtherPage
    end

    OuterNginx -->|"HTTP / WebSocket"| ViteDev
    ViteDev -->|"App bundle + HMR"| Router
    ApiFetch -->|"HTTP JSON via nginx (/api/*)"| OuterNginx
```

### 3. Express API Service (`api`)

Handles REST requests forwarded from `nginx` on `:5000` ([`server/index.js`](./server/index.js)), validating inputs, computing Fibonacci numbers recursively, and updating in-memory state.

```mermaid
flowchart TB
    OuterNginx["nginx Reverse Proxy\n(forwards '/api/*' as '/*' to api:5000)"]

    subgraph ApiSvc["api Service (:5000 | server/index.js)"]
        Middleware["Express Middleware\ncors() -> express.json()"]

        subgraph Endpoints["Route Handlers"]
            GetRoot["GET /"]
            GetValues["GET /values"]
            PostValues["POST /values\nBody: { index }"]
        end

        subgraph PostFlow["POST /values Request & Data Flow"]
            Validate{"parseInt(index, 10)\nvalid & 0 <= index <= 40?"}
            Err422["HTTP 422\n'Invalid index' or 'Index too high'"]
            AppendIdx["seenIndexes.push(parsedIndex)"]
            CacheCheck{"calculatedValues[key]\nexists?"}
            ComputeFib["fib(parsedIndex)\nRecursive O(2^n)\ncalculatedValues[key] = result"]
            OkJson["HTTP 200 JSON\n{ seenIndexes, calculatedValues }"]

            Validate -->|"No"| Err422
            Validate -->|"Yes"| AppendIdx --> CacheCheck
            CacheCheck -->|"Miss"| ComputeFib --> OkJson
            CacheCheck -->|"Hit"| OkJson
        end

        HealthResp["HTTP 200\n'Hi'"]
        MemData[("In-Memory Data\nseenIndexes: [7, ...]\ncalculatedValues: { '7': 21, ... }")]

        Middleware --> GetRoot --> HealthResp
        Middleware --> GetValues
        Middleware --> PostValues --> Validate

        GetValues <-->|"read"| MemData
        GetValues --> OkJson
        AppendIdx -->|"append"| MemData
        CacheCheck -.->|"lookup"| MemData
        ComputeFib -->|"write"| MemData
    end

    OuterNginx -->|"HTTP :5000"| Middleware
    HealthResp -.->|"response"| OuterNginx
    OkJson -.->|"JSON response"| OuterNginx
    Err422 -.->|"422 response"| OuterNginx
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
