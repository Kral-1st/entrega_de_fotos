# Entrega de Fotos

Plataforma de entrega de fotografías para clientes. Corriendo en tu servidor con Node.js/Express + SQLite.

## Estructura

```
entrega_de_fotos/
├── server/          # API Express (corre en puerto 3000)
├── client/
│   ├── admin/       # Panel de administración (solo tú)
│   └── gallery/     # Vista pública del cliente
├── uploads/         # Fotos organizadas por proyecto
└── logs/            # PM2 logs
```

## URLs

| Servicio | URL |
|---|---|
| API | `https://api-fotos.carlangas.dpdns.org` |
| Admin | `https://fotos.carlangas.dpdns.org/admin/` |
| Cliente | `https://fotos.carlangas.dpdns.org/p/[slug]` |

---

## Deploy

### 1. Instalar dependencias

```bash
cd /mnt/almacenamiento/entrega_de_fotos
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
nano .env
```

Cambiar obligatoriamente:
- `JWT_SECRET` → string largo y aleatorio (`openssl rand -hex 32`)
- `ADMIN_PASSWORD` → tu contraseña de admin

### 3. Crear directorios necesarios

```bash
mkdir -p /mnt/almacenamiento/entrega_de_fotos/{uploads,logs}
```

### 4. Nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/entrega-fotos
sudo ln -s /etc/nginx/sites-available/entrega-fotos /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Cloudflare Tunnel

Agregar las dos entradas en tu tunnel config:
```yaml
ingress:
  - hostname: api-fotos.carlangas.dpdns.org
    service: http://localhost:80
  - hostname: fotos.carlangas.dpdns.org
    service: http://localhost:80
```

O si usas el dashboard de Cloudflare, crear los dos public hostnames apuntando al servidor.

### 6. PM2

```bash
cd /mnt/almacenamiento/entrega_de_fotos
pm2 start ecosystem.config.js
pm2 save
```

---

## Uso

### Admin

1. Ir a `https://fotos.carlangas.dpdns.org/admin/`
2. Iniciar sesión con la contraseña del `.env`
3. Crear proyecto → nombre, cliente, descripción, PIN opcional
4. Subir fotos arrastrando o seleccionando
5. Copiar el link del cliente y mandárselo

### Cliente

1. Abre `https://fotos.carlangas.dpdns.org/p/[slug]`
2. Si tiene PIN, lo ingresa
3. Ve las fotos en grid masonry
4. Descarga individual o ZIP completo

---

## Comandos útiles

```bash
# Ver logs en tiempo real
pm2 logs entrega-fotos-api

# Reiniciar
pm2 restart entrega-fotos-api

# Ver estado
pm2 status
```

## Cambiar contraseña de admin

```bash
# Editar .env con la nueva contraseña
nano .env

# Borrar la DB para que se regenere el hash
rm /mnt/almacenamiento/entrega_de_fotos/server/db/database.sqlite

# Reiniciar
pm2 restart entrega-fotos-api
```

> ⚠️ Esto borra todos los proyectos. Si quieres conservarlos, usa node -e "..." para actualizar solo el hash.
