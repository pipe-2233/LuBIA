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

## Paso 2 — Servidor local requerido

> ⚠️ **Importante: se necesita un servidor local en la oficina para la conexión con el AirPort.**

### ¿Por qué?

| Entorno | ¿Ve el AirPort? | ¿Por qué? |
|---|---|---|
| **Render (nube)** | ❌ No | Render está en un datacenter en Oregón, EE.UU. No puede acceder a `192.168.1.50` porque es una IP privada de la red local de la oficina. |
| **Servidor local (oficina)** | ✅ Sí | Una PC o laptop en la misma red WiFi de la oficina sí tiene acceso directo al AirPort por SMB. |

**Flujo:**
```
cPanel (internet) ──IMAP──→ Servidor local (oficina) ──SMB──→ AirPort Extreme (red local)
```

LUBIA en Render sigue funcionando para todo lo demás (dashboard, proyectos, audio, chat, archivos). El módulo de archivo de correos corre en el servidor local de la oficina porque es el único que tiene acceso físico al disco AirPort.

### Requisitos del servidor local

| Requisito | Detalle |
|---|---|
| Hardware | Cualquier PC o laptop de la oficina (4GB RAM mínimo) |
| Sistema | Windows, Linux o macOS |
| Node.js | v20 o superior |
| Conexión | Mismo WiFi/router que el AirPort Extreme |
| Funcionamiento | Solo se necesita encendida al ejecutar el archivo de correos (cada 3 meses aprox.) |

### 2.1 Montar el disco AirPort (Windows)

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

**Checkpoint:** `dir Z:\` muestra los archivos del disco AirPort.

---

## Paso 3 — Script local de archivo

### 3.1 Instalar Node.js en el servidor local

Descargar e instalar [Node.js v20+](https://nodejs.org) en la PC de la oficina.

### 3.2 Clonar LUBIA en la PC local

```powershell
cd C:\
git clone https://github.com/pipe-2233/LuBIA.git
cd LuBIA
npm install
```

### 3.3 Script de archivo (`archivar.js`)

El script se conecta a cPanel por IMAP, descarga correos viejos y los guarda en `Z:\correos`.

```javascript
// archivar.js — Ejecutar: node archivar.js
import { ImapFlow } from "imapflow";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG = {
  imapHost: "mail.ingelubsa.com",
  imapPort: 993,
  imapUser: "correo@ingelubsa.com",    // ← cambiar
  imapPass: "contraseña",               // ← cambiar
  rutaDisco: "Z:\\correos",
  antiguedad: 12,                       // meses
  borrarDespues: false,                 // true para borrar de cPanel
};

const corte = new Date();
corte.setMonth(corte.getMonth() - CONFIG.antiguedad);

const client = new ImapFlow({
  host: CONFIG.imapHost, port: CONFIG.imapPort, secure: true,
  auth: { user: CONFIG.imapUser, pass: CONFIG.imapPass }, logger: false,
});

let total = 0, bytes = 0;
console.log("Conectando a", CONFIG.imapHost, "...");
await client.connect();

for (const f of await client.list()) {
  await client.mailboxOpen(f.path);
  const found = await client.search({ before: corte });
  if (!found.length) continue;
  console.log(`${f.path}: ${found.length} correos`);

  for (const seq of found.slice(0, 500)) {
    try {
      const msg = await client.fetchOne(seq, { envelope: true, source: true });
      const d = msg.envelope.date || new Date();
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0");
      const from = (msg.envelope.from || [{ address: "desconocido" }])[0]?.address || "desconocido";
      const sub = (msg.envelope.subject || "sin-asunto").slice(0, 60).replace(/[^a-zA-Z0-9 _-]/g, "_");

      const dir = join(CONFIG.rutaDisco, String(y), m, from.replace(/[^a-zA-Z0-9@._-]/g, "_"));
      mkdirSync(dir, { recursive: true });
      const fn = `${d.toISOString().split("T")[0]}_${sub}_${seq}.eml`.replace(/[/\\?%*:|"<>]/g, "_");
      writeFileSync(join(dir, fn), msg.source);
      total++; bytes += msg.source.length;
      if (CONFIG.borrarDespues) await client.messageDelete(seq);
    } catch {}
  }
}

await client.logout();
console.log(`✅ ${total} correos archivados (${(bytes/1024/1024).toFixed(1)} MB) en ${CONFIG.rutaDisco}`);
```

### 3.4 Ejecutar

```powershell
cd C:\LuBIA
node archivar.js
```

Salida esperada:
```
Conectando a mail.ingelubsa.com ...
INBOX: 342 correos
Sent: 89 correos
✅ 431 correos archivados (210.5 MB) en Z:\correos
```

---

## Paso 4 — Ejecución y verificación

### 4.1 Prueba seca (sin borrar)

1. Asegurate de que `Z:\` esté montado (Paso 2)
2. En `archivar.js`, verificá que `borrarDespues: false`
3. Ejecutá: `node archivar.js`
4. Verificá que `Z:\correos\2024\...` tenga archivos `.eml`

**Checkpoint:** El AirPort muestra correos organizados por año/mes/remitente.

### 4.2 Archivo definitivo

1. Cambiá `borrarDespues: true` en `archivar.js`
2. Ejecutá: `node archivar.js`
3. Verificá cPanel → menos espacio usado

**Checkpoint:** cPanel liberó espacio.

### 4.3 Automatización (futuro)

Crear una tarea programada en Windows para ejecutar `node C:\LuBIA\archivar.js` cada 3 meses:

```powershell
# PowerShell como admin
$action = New-ScheduledTaskAction -Execute "node" -Argument "C:\LuBIA\archivar.js"
$trigger = New-ScheduledTaskTrigger -Monthly -Months 3,6,9,12 -At "02:00AM"
Register-ScheduledTask -TaskName "LUBIA Archivar Correos" -Action $action -Trigger $trigger
```

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
│                         ARQUITECTURA COMPLETA                         │
│                                                                      │
│  ┌─────────────────────────────────────────┐                        │
│  │  Render (Nube - Oregón, EE.UU.)         │                        │
│  │  lubia-bcnm.onrender.com                │                        │
│  │                                          │                        │
│  │  ✅ Dashboard web                        │                        │
│  │  ✅ Proyectos, archivos, chat            │                        │
│  │  ✅ Audio → Deepgram → Claude → Excel    │                        │
│  │  ❌ NO accede al AirPort (red distinta)  │                        │
│  └─────────────────────────────────────────┘                        │
│                                                                      │
│  ┌─────────────────────────────────────────┐                        │
│  │  Servidor Local (Oficina INGELUBSA)     │                        │
│  │  PC Windows, misma red WiFi             │                        │
│  │                                          │                        │
│  │  Corre script de archivo cada 3 meses:  │                        │
│  │  1. Conecta a cPanel por IMAP           │                        │
│  │  2. Descarga correos de +1 año          │                        │
│  │  3. Guarda .eml en Z:\ (AirPort)        │                        │
│  │  4. Borra de cPanel                     │                        │
│  └──────────────┬──────────────────────────┘                        │
│                 │ SMB (red local)                                    │
│                 ▼                                                    │
│  ┌─────────────────────────────────────────┐                        │
│  │  AirPort Extreme + Disco USB 2TB         │                        │
│  │  IP: 192.168.1.50                        │                        │
│  │  Montado como Z:\ en el servidor local   │                        │
│  │                                          │                        │
│  │  Correos organizados por:               │                        │
│  │  Z:\correos\AÑO\MES\remitente\          │                        │
│  └─────────────────────────────────────────┘                        │
│                                                                      │
│  ┌─────────────────────────────────────────┐                        │
│  │  cPanel (mail.ingelubsa.com)            │                        │
│  │  20GB → se libera espacio               │                        │
│  │  Los correos archivados ya no ocupan    │                        │
│  │  espacio en el hosting                  │                        │
│  └─────────────────────────────────────────┘                        │
│                                                                      │
│  Flujo: cPanel → IMAP → Servidor Local → SMB → AirPort              │
│         LUBIA (Render) = Dashboard para todo lo demás               │
└─────────────────────────────────────────────────────────────────────┘
```
