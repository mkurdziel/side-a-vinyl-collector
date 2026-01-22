# Ansible Deployment for Vinyl Collector

This directory contains Ansible playbooks for deploying Vinyl Collector to your homelab.

## Prerequisites

1. PostgreSQL database server accessible on your network
2. Traefik reverse proxy configured on the `homelab` Docker network
3. Ansible variables defined:
   - `username` - PostgreSQL username
   - `default_pass` - PostgreSQL password
   - `host_db` - PostgreSQL host
   - `host_redis` - Redis host (or use the deployed vinyl_redis container)
   - `docker_dir` - Base directory for Docker volumes
   - `vinyl_discogs_token` - Discogs API token
   - `vinyl_anthropic_key` - Anthropic API key (optional)
   - `vinyl_openai_key` - OpenAI API key (optional)

## Deployment

Run the playbook:

```bash
ansible-playbook vinyl-collector.yml
```

## What Gets Deployed

1. **PostgreSQL Database**: `vinyl_collector` database
2. **Redis Container**: `vinyl_redis` for caching
3. **Vinyl Collector Container**: `vinyl_collector` - single container with backend + frontend
4. **Traefik Integration**: Accessible at `https://vinyl.local.domain.com`

## Volumes

- `{{ docker_dir }}/vinyl/cover-art` - Album cover art storage
- `{{ docker_dir }}/vinyl/redis_data` - Redis persistence

## Ports

- `9042:5001` - Vinyl Collector web interface and API

## Notes

- The service uses the combined single-container image from GHCR
- Both frontend and backend are served from port 5001
- Redis runs as a separate container for caching
- PostgreSQL is expected to be running externally
