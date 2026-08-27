# Internet Monitor

Monitorea la conexion a internet en segundo plano: hace ping cada ~2s a 1.1.1.1, 8.8.8.8 y 9.9.9.9, revisa resolucion DNS, y guarda historial local de latencia, perdida de paquetes y caidas (hasta las de menos de un segundo). Incluye un dashboard web local con zoom para ver graficas y el registro de caidas.

Funciona en macOS y Windows (ver abajo).

## Uso manual (probar sin instalar)

```bash
npm start
```

Luego abre http://localhost:5757

## Uso en Windows (por ejemplo, en el laptop de un tecnico)

1. Instala [Node.js](https://nodejs.org) (version LTS) si no lo tiene.
2. Copia toda esta carpeta (por USB o como sea) al equipo Windows.
3. Haz doble click en `start-windows.bat`. La primera vez instala las dependencias solo si falta la carpeta `node_modules`; despues arranca el monitor.
4. Deja esa ventana abierta y abre `http://localhost:5757` en el navegador.

Las notificaciones nativas (banner del sistema) solo funcionan en macOS; en Windows el aviso visual/sonoro del propio dashboard (la pantalla que se pone roja cuando se cae) sigue funcionando igual mientras la pagina este abierta.

## Instalar como servicio permanente en macOS (arranca solo, corre siempre)

```bash
./scripts/install.sh
```

Esto crea un LaunchAgent en `~/Library/LaunchAgents` que arranca el monitor al iniciar sesion y lo reinicia si se cae.

## Desinstalar el servicio

```bash
./scripts/uninstall.sh
```

## Generar un reporte en PDF (para tu operador de internet)

```bash
npm run report
```

Genera un PDF con resumen de uptime, grafica de estado/latencia, desglose por dia y el detalle de cada caida (fecha, hora de inicio/fin y duracion), usando los ultimos 7 dias de datos. Queda guardado en `reports/reporte-internet-<fecha>.pdf`.

Para otro periodo o nombre de archivo:

```bash
node scripts/report.js --days=30 --out=reports/mi-reporte.pdf
```

## Datos

Los datos se guardan en `data/` (un archivo `.jsonl` por dia, mas `outages.jsonl` con el registro de caidas). Se limpian automaticamente pasados 30 dias.
