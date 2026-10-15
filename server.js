import express from "express";
import { join } from "node:path";
import { ROOT_DIR, DATA_DIR, getSetting } from "./src/config/env.js";

import projectsRoutes from "./src/routes/projects.routes.js";
import filesRoutes from "./src/routes/files.routes.js";
import aiRoutes from "./src/routes/ai.routes.js";
import excelRoutes from "./src/routes/excel.routes.js";
import templatesRoutes from "./src/routes/templates.routes.js";
import correosRoutes from "./src/routes/correos.routes.js";
import settingsRoutes from "./src/routes/settings.routes.js";
import muestrasRoutes from "./src/routes/muestras.routes.js";
import mailRoutes from "./src/routes/mail.routes.js";

const app = express();

// Middlewares globales
app.use(express.json());
app.use(express.static(join(ROOT_DIR, "public")));

// Montaje de rutas modulares API
app.use("/api", projectsRoutes);
app.use("/api", filesRoutes);
app.use("/api", aiRoutes);
app.use("/api", excelRoutes);
app.use("/api", templatesRoutes);
app.use("/api", correosRoutes);
app.use("/api", settingsRoutes);
app.use("/api", muestrasRoutes);
app.use("/api", mailRoutes);

// Manejador global de errores no capturados en rutas
app.use((err, _req, res, _next) => {
  console.error("[Server Error]", err);
  res.status(500).json({ error: err.message || "Error interno del servidor" });
});

// Inicio del servidor
const PORT = getSetting("PORT") || process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`LUBIA corriendo en http://localhost:${PORT}`);
  console.log(`Datos en: ${DATA_DIR}`);
});
