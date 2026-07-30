# 📧 Plan: Archivo de Correos cPanel → AirPort Extreme con LUBIA

## Objetivo

Mover correos de +1 año desde cPanel (saturado, 20GB) al AirPort Extreme (2TB), manteniéndolos organizados por fecha/remitente y buscables desde LUBIA. Liberar espacio en cPanel.

---

## Paso 1 — Hardware: Conectar y configurar el AirPort Extreme

### 1.1 Conexión física

```
┌──────────────┐         ┌─────────────────────┐
│ Router Oficina │ ────── │ AirPort Extreme      │  Puerto WAN
│   (principal)  │  cable  │  IP: 192.168.1.XX    │
└──────────────┘  ethernet└──────────┬──────────┘
                                     │ Puerto USB
                                     │
                              ┌──────┴──────┐
                              │  Disco 2TB   │
                              │  (ya puesto)  │
                              └─────────────┘
```

Si el AirPort ya está conectado al router y encendido, pasá al 1.2.

### 1.2 Abrir AirPort Utility

| Sistema | Cómo |
|---|---|
| **macOS** | Aplicaciones → Utilidades → AirPort Utility |
| **Windows** | Descargar de [apple.com](https://support.apple.com/downloads/airport) |
| **iOS** | App Store → AirPort Utility |

### 1.3 Configurar compartición de archivos

1. Seleccioná el AirPort Extreme en la lista → clic en **Editar**
2. Pestaña **Discos**:
   - ✔ Habilitar **"Enable file sharing"**
   - ✔ Opcional: **"Share disks over WAN"** (acceso desde fuera de la oficina)
   - Seguridad: elegí **"With device password"** (más simple)
3. Pestaña **File Sharing**:
   - ✔ Permitir **lectura y escritura** para todos
4. Clic en **Actualizar** → el AirPort se reinicia (1-2 minutos)

### 1.4 Anotar la IP del AirPort

1. En AirPort Utility, seleccioná el AirPort
2. Anotá la **dirección IP** (ej: `192.168.1.50`)
3. Anotá el **nombre del disco** (ej: `DiscoAirport`)

**Checkpoint 1:** Abrí una terminal y hacé `ping 192.168.1.50`. Debe responder.

---

## Paso 2 — Montar el disco AirPort en el servidor LUBIA

### 2.1 Si LUBIA corre en Windows (PC local)

```powershell
# Mapear como unidad de red (letra Z:)
net use Z: \\192.168.1.50\DiscoAirport /user:admin TU_CLAVE /persistent:yes

# Verificar
dir Z:\
```

Si no sabés la clave del AirPort:
- Es la contraseña que configuraste en AirPort Utility
- O es la contraseña del WiFi
- Para verla: AirPort Utility → AirPort → Editar → pestaña "Base Station"

**Checkpoint 2:** `dir Z:\` muestra los archivos del disco AirPort.

### 2.2 Si LUBIA corre en Linux (Render, VPS)

```bash
# Instalar cliente SMB/CIFS
sudo apt update && sudo apt install cifs-utils -y

# Crear carpeta de montaje
sudo mkdir -p /mnt/correos

# Montar el disco
sudo mount -t cifs //192.168.1.50/DiscoAirport /mnt/correos \
  -o username=admin,password=TU_CLAVE,vers=3.0

# Verificar
ls /mnt/correos/
```

### 2.3 Configurar ruta en LUBIA

En el código de LUBIA, la variable `CORREOS_PATH` apunta a:
- **Windows:** `Z:\` (unidad mapeada)
- **Linux:** `/mnt/correos/`
- Se configura en el Settings de LUBIA (⚙️) como `RUTA_CORREOS`

---

## Paso 3 — LUBIA: Código del módulo de correos

### 3.1 Instalar dependencia IMAP

```bash
cd C:\Users\pipe\Desktop\LuBIA
npm install imapflow
```

### 3.2 Endpoint: `POST /api/correos/archivar`

El endpoint recibe:
```json
{
  "imapHost": "mail.ingelubsa.com",
  "imapPort": 993,
  "imapUser": "correo@ingelubsa.com",
  "imapPass": "contraseña",
  "antiguedad": 12,
  "rutaArchivo": "/mnt/correos",
  "borrarDespues": false
}
```

Y hace:
1. Conecta a cPanel por IMAP
2. Busca correos de más de X meses en INBOX + carpetas
3. Descarga cada correo como archivo `.eml`
4. Organiza por ruta: `rutaArchivo/AÑO/MES/remitente@dominio/asunto_uid.eml`
5. Opcional: borra del servidor cPanel
6. Devuelve: `{ totalArchivados, espacioEstimado, ruta }`

### 3.3 UI en LUBIA: Pestaña "📧 Correos"

En el proyecto "Archivo Correos" aparece una nueva sección con:
- Formulario: host IMAP, usuario, contraseña, antigüedad
- Selector de ruta (del disco montado)
- Checkbox "Borrar del servidor al archivar"
- Botón "Ejecutar Archivo"
- Resultados: conteo, espacio liberado, ruta de archivos

### 3.4 Vista de correos archivados

Sección para buscar correos ya archivados:
- Filtro por fecha, remitente, asunto
- Preview del contenido del `.eml`
- Exportar/descargar correo individual

---

## Paso 4 — Ejecución y verificación

### 4.1 Prueba seca (sin borrar)

1. Abrí LUBIA → proyecto "Archivo Correos"
2. Completá los datos IMAP
3. Antigüedad: 12 meses
4. **Desmarcá** "Borrar del servidor"
5. Clic en **Ejecutar Archivo**

**Checkpoint 3:** El AirPort debe mostrar archivos `.eml` organizados por año/mes.

### 4.2 Archivo definitivo

Repetí el paso 4.1 pero **marcando** "Borrar del servidor".

**Checkpoint 4:** cPanel muestra menos espacio usado.

### 4.3 Automatización (futuro)

- Agregar endpoint `POST /api/correos/auto` que ejecute el archivo automáticamente
- Configurar cron job o botón "Auto-Archivar cada 3 meses"

---

## Solución de problemas

| Problema | Solución |
|---|---|
| `ping 192.168.1.50` no responde | AirPort no conectado al router. Revisar cable ethernet y que esté encendido. |
| `net use` da error 53 | IP incorrecta o nombre del disco mal. Verificar en AirPort Utility. |
| `net use` da error de acceso | Usuario/contraseña incorrectos. Verificar en AirPort Utility. |
| IMAP no conecta | cPanel puede tener puerto IMAP bloqueado. Usar IMAP en cPanel → "Configuración de cliente de correo". |
| Error "Maximum call stack" en @ picker | Ya solucionado en el código de LUBIA (build más reciente). |
| Correos no se borran de cPanel | Verificar que la cuenta IMAP tenga permisos de eliminación. |

---

## Diagrama final

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FLUJO COMPLETO                               │
│                                                                      │
│  cPanel (20GB, saturado)                                             │
│       │                                                              │
│       │ IMAP (puerto 993, SSL)                                       │
│       ▼                                                              │
│  ┌──────────────┐     POST /api/correos/archivar                     │
│  │   LUBIA      │ ◄──  Formulario en el dashboard                   │
│  │  (servidor)  │                                                    │
│  └──────┬───────┘                                                    │
│         │                                                            │
│         │ Guarda archivos .eml                                       │
│         ▼                                                            │
│  /mnt/correos/                                                       │
│  ├── 2023/                                                           │
│  │   ├── 01/                                                         │
│  │   │   ├── cliente-a@correo.com/                                   │
│  │   │   │   ├── factura-001.eml                                     │
│  │   │   │   └── cotizacion-002.eml                                  │
│  │   │   └── proveedor@correo.com/                                   │
│  │   └── 02/                                                         │
│  ├── 2024/                                                           │
│  └── 2025/                                                           │
│         │                                                            │
│         │ Montado vía SMB                                            │
│         ▼                                                            │
│  ┌──────────────────┐                                                │
│  │ AirPort Extreme   │                                               │
│  │ Disco USB 2TB     │                                               │
│  └──────────────────┘                                                │
│                                                                      │
│  Buscador en LUBIA → buscás por fecha/remitente/asunto → preview     │
│  cPanel ahora tiene espacio libre                                    │
└─────────────────────────────────────────────────────────────────────┘
```
