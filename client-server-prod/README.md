# Client-Server Prod (AWS Architecture)

Production-ready AWS deployment of the Fibonacci calculator app using a **split custom-domain architecture** configured manually in the AWS Console:

- **Frontend (`https://fib1.techtoday.click`):** Static React + Vite SPA hosted in a private **Amazon S3** bucket and served globally over HTTPS via **Amazon CloudFront** (OAC) + **AWS ACM** (`us-east-1`).
- **Backend (`https://api.fib1.techtoday.click`):** Containerized Express API running on **Amazon EC2** behind **Nginx** + **Certbot**, which automatically provisions and renews Let's Encrypt HTTPS certificates and reverse-proxies requests to the private `api:5000` container.
- **Storage:** In-memory JavaScript structures (`seenIndexes`, `calculatedValues`) inside the single EC2 API container.

> **Note:** Because data is stored in memory, keep the backend at **1 container instance** on EC2. Submitted values reset if the `api` container restarts. For persistence or horizontal scaling, replace the in-memory store with Amazon DynamoDB or RDS + ElastiCache.

---

## Architecture

```mermaid
flowchart LR
    User(["Browser / User"])

    subgraph Frontend["AWS Global Edge + Static Hosting"]
        CF["Amazon CloudFront\nhttps://fib1.techtoday.click\n(ACM Cert in us-east-1)"]
        S3["Amazon S3 (Private + OAC)\nclient/dist/ (React SPA)"]
        CF -->|"OAC Read"| S3
    end

    subgraph Backend["AWS EC2 (Elastic IP -> api.fib1.techtoday.click)"]
        Nginx["Nginx + Certbot (Docker)\n:80 / :443 Let's Encrypt HTTPS"]
        API["Express API (Docker)\nInternal :5000\nCORS + In-Memory Store"]
        Nginx -->|"proxy_pass http://api:5000"| API
    end

    User -->|"HTTPS GET /, /otherpage"| CF
    User -->|"HTTPS CORS GET/POST /values"| Nginx
```

---

## Project Structure

```text
.github/workflows/
└── client-server-prod.yml     # CI/CD workflow (S3 + CloudFront frontend, EC2 + Nginx backend)

client-server-prod/
├── README.md                  # Architecture overview
├── AWS.md                     # Manual AWS Console setup guide (ACM, S3, CloudFront, EC2, DNS, IAM)
├── DEPLOY.md                  # Step-by-step frontend sync, EC2/Nginx deploy, CI/CD, and teardown guide
├── client/                    # React 18 + Vite SPA (builds to static dist/ for S3)
│   ├── .env.example           # Example VITE_API_URL for production builds
│   ├── package.json           # Includes `npm run build` for static output
│   └── src/                   # React components (Fib.jsx, OtherPage.jsx, App.jsx)
├── server/                    # Production Express API
│   ├── Dockerfile             # Non-root production Node 22 Alpine image + HEALTHCHECK
│   ├── .dockerignore
│   ├── index.js               # Env-driven PORT, CORS allowlist (CLIENT_ORIGIN), graceful shutdown
│   └── package.json           # Includes `npm start`
└── ec2/                       # EC2 production runtime stack
    ├── .env.example           # API_DOMAIN, CLIENT_ORIGIN, ACME_EMAIL
    ├── docker-compose.prod.yml # Express API + Nginx + Certbot stack
    └── nginx/
        ├── default.conf.template # HTTPS reverse proxy to api:5000 + ACME challenge
        └── entrypoint.sh         # Bootstraps HTTP-only for Certbot, then enables HTTPS & reloads
```

---

## Key Production Differences from `client-server-local`

| Area | `client-server-local` | `client-server-prod` |
| :--- | :--- | :--- |
| **Frontend serving** | Vite dev server in Docker (`:3000`) | Static `vite build` output on **S3 + CloudFront** (`https://fib1.techtoday.click`) |
| **Backend serving** | `nodemon` in Docker (`:5000` exposed) | Production `Dockerfile` (`node index.js`, non-root) behind **Nginx** (`:443` HTTPS, `:5000` private) |
| **CORS** | Open `cors()` | Strict origin allowlist via `CLIENT_ORIGIN` |
| **HTTPS / TLS** | Local HTTP only | **ACM (`us-east-1`)** on CloudFront + **Nginx + Certbot (Let's Encrypt)** on EC2 |
| **Process lifecycle** | Dev auto-restart | `restart: unless-stopped`, Docker `HEALTHCHECK`, graceful `SIGTERM`/`SIGINT` shutdown |

---

## Deployment

- **[AWS.md](./AWS.md)** — Manual AWS Console setup guide (ACM `us-east-1`, S3 + OAC, CloudFront, EC2 + Elastic IP + Security Group, DNS, GitHub OIDC IAM role, costs & teardown).
- **[DEPLOY.md](./DEPLOY.md)** — Step-by-step frontend build/sync, EC2/Nginx deployment, verification, and GitHub Actions CI/CD.
