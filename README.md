# LUBIA — Asistente IA para INGELUBSA S.A.S.

**LUBIA** es el asistente de inteligencia artificial de **INGELUBSA S.A.S.**, diseñado para digitalizar y automatizar los procesos técnicos de lubricación industrial, monitoreo de activos y gestión documental.

---

## Objetivo

Centralizar en un solo workspace toda la información técnica de los proyectos de INGELUBSA: audios de campo, transcripciones, documentos generados por IA, archivos del proyecto y correos archivados. LUBIA convierte datos crudos (audios, documentos, correos) en activos de información estructurada y trazable.

---

## ¿Qué problemas resuelve?

| Antes | Ahora con LUBIA |
|---|---|
| Audios de campo sin procesar | Transcripción automática con Deepgram → extracción de datos estructurados con Claude → Excel listo para entregar |
| Correos acumulados en cPanel (espacio agotado) | Archivo automático al AirPort Extreme, organizados por año/mes/remitente, buscables |
| Documentos dispersos en PCs y correos | Workspace por proyecto con archivos, carpetas, chat IA |
| Sin trazabilidad de reuniones | Grabación de Meet → transcripción con speakers → notas automáticas |
| Información repetitiva (plantillas) | Claude rellena plantillas de lubricación, muestras y pruebas con datos de audio |

---

## Funcionalidades

| Módulo | Descripción |
|---|---|
| 🎤 **Audio a Excel** | Subir audio de campo → Deepgram transcribe → Claude extrae datos → Excel con formato INGELUBSA |
| 📁 **Archivos por proyecto** | Subir, organizar en carpetas, arrastrar y soltar. Cada proyecto tiene su propio repositorio de documentos |
| 💬 **Chat IA** | Chat contextual del proyecto. Citar archivos del proyecto con `@`. Próximamente conectado a Claude |
| 📧 **Correos** | Archivar correos de cPanel al AirPort Extreme vía IMAP. Buscador, preview de .eml, organizados por fecha/remitente |
| 📋 **Proyectos** | Workspace independiente por proyecto/cliente. Trazabilidad completa |
| ⚙️ **Settings** | Configurar API keys de Deepgram y Claude desde la interfaz, sin tocar el servidor |

---

## Arquitectura

```
┌────────────────────────────────────────────────────────┐
│  LUBIA Dashboard (Render, nube)                         │
│  lubia-bcnm.onrender.com                               │
│                                                         │
│  ✅ Proyectos, archivos, chat                           │
│  ✅ Audio → Deepgram → Claude → Excel                   │
│  ✅ Accesible desde cualquier lugar                     │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  Servidor Local (Oficina INGELUBSA)                     │
│                                                         │
│  📧 Archivo de correos cPanel → AirPort (IMAP → SMB)   │
│  🎤 Extensión Chrome Meet → Deepgram → Ollama          │
└────────────────────┬───────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────┐
│  AirPort Extreme 2TB                                    │
│  Correos, respaldos, archivos del proyecto              │
└────────────────────────────────────────────────────────┘
```

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Backend | Node.js + Express |
| Dashboard | HTML5, CSS3, JavaScript vanilla (sin frameworks) |
| Base de datos | JSON en disco (data/) |
| Transcripción | Deepgram Nova-3 |
| IA principal | Claude 3.5 Sonnet (Anthropic) |
| IA reuniones | Ollama local (qwen2.5) |
| Excel | ExcelJS |
| Correos | IMAP (imapflow) |
| Despliegue | Render (gratis) + servidor local Windows |

---

## Estructura del proyecto

```
LuBIA/
├── server.js              # Backend: Express + Deepgram + Claude + ExcelJS + IMAP
├── package.json
├── .env                    # API keys (no se sube a git)
├── public/
│   └── index.html          # Dashboard completo (SPA)
├── docs/
│   └── CORREOS.md          # Guía de configuración AirPort + archivo de correos
├── data/                    # Datos persistentes (proyectos, settings, archivos)
└── exports/                 # Excel generados
```

---

## Cómo iniciar

### Dashboard (Render)
Desplegado automáticamente desde GitHub. Acceso en `lubia-bcnm.onrender.com`.

### Local
```bash
git clone https://github.com/pipe-2233/LuBIA.git
cd LuBIA
npm install
node server.js
# Abrir http://localhost:3000
```

### Variables de entorno (`.env`)
```env
DEEPGRAM_API_KEY=
CLAUDE_API_KEY=
PORT=3000
```

También se pueden configurar desde la UI en ⚙️ Settings.

---

## Créditos

Desarrollado para **INGELUBSA S.A.S.** — Lubricación y Confiabilidad Industrial Colombia.

Cali, Valle del Cauca, Colombia.
