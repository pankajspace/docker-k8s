# Client-Server Local Architecture

A minimal 2-container version of the Fibonacci calculator application using only **React Client** and **Express API Server** — with no Nginx reverse proxy, PostgreSQL, Redis, or separate background worker.

- **Direct Communication (No Reverse Proxy)**: Both `client` (`:3000`) and `api` (`:5000`) expose their ports directly to the host. The browser loads the React SPA from `http://localhost:3000` and makes direct cross-origin (`CORS`) API requests to `http://localhost:5000` (configurable via `VITE_API_URL`).
- **Storage**: Uses simple in-memory JavaScript data structures (`seenIndexes` array and `calculatedValues` object) inside `server/index.js`.
- **Calculation**: The recursive `fib(index)` function runs directly inside the Express server.

> Note: Because data is stored in server memory, submitted indexes and calculated values reset when the `api` container restarts.

## Architecture

### Simple Overview

```mermaid
flowchart LR
    User(["Browser / User"])

    subgraph Docker["Docker Network (docker-compose)"]
        Client["React Client\n(Host :3000 -> :3000)\nVite Dev Server"]
        API["Express API Server\n(Host :5000 -> :5000)\nIn-Memory Data + fib()"]
    end

    User -->|"HTTP / WS :3000\n(/, /otherpage, HMR)"| Client
    User -->|"Direct CORS HTTP :5000\n(GET/POST /values)"| API
```

### Detailed Architecture (Request & Data Flow)

```mermaid
flowchart TB
    Browser(["Browser\nhttp://localhost:3000"])

    subgraph ClientSvc["client Service (:3000 -> :3000)"]
        ClientServer["Vite Dev Server (:3000)\nServes SPA bundle + HMR WebSocket"]
        ReactSPA["React 18 SPA (runs in Browser)\nApp.jsx -> '/' Fib.jsx | '/otherpage' OtherPage.jsx"]
        ClientServer -->|"HTML / JS / CSS + HMR"| ReactSPA
    end

    subgraph ApiSvc["api Service (:5000 -> :5000)"]
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

    Browser -->|"1. GET / or /otherpage (:3000)"| ClientServer
    ReactSPA -->|"2. GET http://localhost:5000/values (mount / refresh)\n3. POST http://localhost:5000/values { index } (submit)"| Middleware
    GetValues -.->|"4. JSON { seenIndexes, calculatedValues }"| Browser
    Err422 -.->|"Error message"| Browser
```

| Service | Container Role | Tech Stack | Port Mapping (Dev) |
| :--- | :--- | :--- | :--- |
| **`client`** | Single-Page Application (SPA) UI (Vite dev server in dev; compiled static assets served by Express in prod) | React 18, Vite, React Router | `3000:3000` |
| **`api`** | REST API, Fibonacci calculator, CORS handler, in-memory storage, and static SPA server (in prod) | Node.js, Express, `cors` | `5000:5000` |

### Why CORS Is Required in Development (and Not in Production)

- **Development (`docker compose up`):** The frontend runs on `http://localhost:3000` and the backend on `http://localhost:5000`. Because the ports differ, browsers treat API requests as **cross-origin**, so `app.use(cors())` in [`server/index.js`](./server/index.js) is required.
- **Production (Single Container — [`Dockerfile`](./Dockerfile)):** There is **zero Nginx**. A multi-stage build compiles the React app with `VITE_API_URL=""` into `/app/public` inside the Express container. Express serves both the API (`/health`, `/values`) and the static SPA (`express.static` + `*` fallback to `index.html`) from the **same origin** on port `5000` (or `$PORT`).

```mermaid
flowchart LR
    User(["Browser / User"])

    subgraph ProdContainer["Single Production Container (:5000)"]
        Express["Express Server (server/index.js)\n/health & /values (REST API + fib())\n/* (Static React SPA + index.html fallback)"]
    end

    User -->|"Same-Origin HTTP :5000\n(UI + API, no CORS, no Nginx)"| Express
```

## Service Architecture Diagrams

### 1. React Client Service (`client`)

Serves the React 18 SPA directly on `:3000` and calls the Express API directly at `VITE_API_URL` (default `http://localhost:5000`).

```mermaid
flowchart TB
    Browser(["Browser\nhttp://localhost:3000"])

    subgraph ClientServer["client Service (:3000 -> :3000)"]
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

            MountOrRefresh -->|"GET ${API_BASE_URL}/values"| ApiFetch["fetch() (Direct CORS)"]
            FormSubmit -->|"POST ${API_BASE_URL}/values\n{ index }"| ApiFetch
            ApiFetch -.->|"200 JSON -> applyServerData()"| UIState
            ApiFetch -.->|"422 / error -> setError()"| UIState
            UIState --> RenderUI
        end

        Router -->|"/"| FibView
        Router -->|"/otherpage"| OtherPage
    end

    ApiTarget["api Service (:5000)\nhttp://localhost:5000"]

    Browser -->|"HTTP / WebSocket (:3000)"| ViteDev
    ViteDev -->|"App bundle + HMR"| Router
    ApiFetch -->|"Direct CORS HTTP (:5000)"| ApiTarget
```

### 2. Express API Service (`api`)

Handles direct REST requests on `:5000` ([`server/index.js`](./server/index.js)), allowing CORS, validating inputs, computing Fibonacci numbers recursively, and updating in-memory state.

```mermaid
flowchart TB
    Browser(["Browser SPA\n(Origin: http://localhost:3000)"])

    subgraph ApiSvc["api Service (:5000 -> :5000 | server/index.js)"]
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

    Browser -->|"Direct HTTP :5000"| Middleware
    HealthResp -.->|"response"| Browser
    OkJson -.->|"JSON response"| Browser
    Err422 -.->|"422 response"| Browser
```

## Quick Start

For full installation, testing, production build, and troubleshooting instructions, see [SETUP.md](./SETUP.md).

```bash
cd client-server-local
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000) (API runs at [http://localhost:5000](http://localhost:5000)).

## API Endpoints

All API requests go directly to the Express server (no `/api` prefix):

- `GET /health` — Health check (`{ "status": "ok" }`)
- `GET /` — Development sanity check (`"Hi"`); in single-container production, serves the React SPA (`index.html`)
- `GET /values` — Returns `{ seenIndexes: [7, ...], calculatedValues: { "7": 21, ... } }`
- `POST /values` — Body `{ "index": "7" }`. Validates `0 <= index <= 40`, computes `fib(index)`, stores it in memory, and returns the updated `{ seenIndexes, calculatedValues }`.
