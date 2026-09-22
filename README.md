# Expedientes de financiación

Herramienta para preparar expedientes de hipotecas y préstamos personales. Incluye:

- un asistente inicial que calcula la documentación necesaria;
- subida de PDF por documento;
- resumen en PDF para el broker;
- descarga del expediente en .zip;
- un tablero kanban por fases.

Todo funciona con planes gratuitos:

| Qué | Dónde |
|---|---|
| Web | GitHub Pages |
| Acceso | Firebase Authentication con cuenta de Google (plan Spark, gratis) |
| Datos de cada expediente | Firestore, en `usuarios/{uid}/expedientes/{id}` (plan Spark, gratis) |
| PDF | Tu Google Drive, en `Mi unidad/Expedientes/{referencia y titular}/` |

La app solo tiene permiso sobre los archivos y carpetas que ella misma crea en tu Drive (permiso `drive.file`). No ve nada más de tu Drive.

## Archivos

- `index.html`, `styles.css`, `app.js`: la aplicación.
- `firebase-config.js`: la configuración de tu proyecto. Es el único archivo que hay que rellenar.
- `firestore.rules`: las reglas de seguridad. Se pegan en la consola de Firebase, sustituyendo antes el correo por el tuyo.

## Funcionamiento de Drive

El permiso de Google Drive dura una hora. Cuando caduca, aparece arriba el botón **Conectar Google Drive**. Un clic y sigues trabajando.

Al quitar un PDF o eliminar un expediente, los archivos van a la papelera de tu Drive, no se borran definitivamente.

## Si algo falla

- **No te deja entrar:**
  - si aparece "dominio no autorizado", añade `TU-USUARIO.github.io` en Authentication > Settings > Dominios autorizados;
  - si aparece "acceso con Google no activado", activa el proveedor Google en Authentication.
- **"Esta cuenta de Google no tiene acceso":** el correo de `firestore.rules` no coincide con el de la cuenta con la que entras.
- **"La API de Google Drive no está activada":** actívala en Google Cloud Console > APIs y servicios > Biblioteca > Google Drive API.
- **Google avisa de que la app no está verificada:** es normal en una app de uso personal. Pulsa "Configuración avanzada" > "Ir a…".
