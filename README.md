# Vinyl Room

Un tocadiscos Braun PS 500 en un salón mid-century, en 3D, que reproduce tu colección de Spotify como si fuera un tocadiscos de verdad: eliges un disco de la caja, lo sacas de la funda, lo pones en el plato, le das a start (o colocas la aguja a mano) y suena la canción que hay grabada en ese surco.

**Demo:** https://danuve3.github.io/spotify-vinyl-player/ (necesita Spotify Premium)

## Cómo se usa

| Acción | Cómo |
| --- | --- |
| Elegir disco | Vista *Discos* (tecla `3`), rueda para pasar discos, clic para cogerlo |
| Sacar el vinilo | Clic en la funda |
| Dar la vuelta | Clic en el vinilo que tienes en la mano, o tecla `F` |
| Ponerlo en el plato | Clic en el plato |
| Automático | Clic en *start*: el brazo va solo al principio de la cara |
| Manual | Palanca de elevación → arrastra el brazo al surco → palanca otra vez |
| Tapa | Clic en la tapa |
| Vistas | `1` sala · `2` tocadiscos · `3` discos · `4` ventana · `5` sillón · rueda para acercarse |

Cada álbum se reparte en caras de hasta ~25 minutos (doble LP si hace falta). Los surcos, los huecos entre canciones y la etiqueta se generan a partir de las duraciones reales, y la posición de la aguja decide qué canción y en qué segundo empieza.

## Desarrollo

```bash
cp .env.example .env   # pon tu Client ID de Spotify
npm install
npm run dev            # http://127.0.0.1:5173
```

En el [dashboard de Spotify](https://developer.spotify.com/dashboard) la app necesita *Web API* y *Web Playback SDK*, y estas Redirect URIs:

- `http://127.0.0.1:5173/callback`
- `https://<usuario>.github.io/spotify-vinyl-player/callback`

Solo se usa el Client ID (flujo PKCE); los tokens se quedan en el navegador del usuario.

## Despliegue

GitHub Pages se publica desde tags, no desde cada push a `main`:

```bash
git tag v0.3.0
git push origin v0.3.0
```

El workflow `Deploy to GitHub Pages` también se puede lanzar a mano desde la pestaña *Actions*. El Client ID sale de la variable de repositorio `SPOTIFY_CLIENT_ID`.

## Estructura

- `blender/turntable.blend` — tocadiscos, discos y habitación. Luz horneada en Cycles (CPU). No está en el repo (67 MB, sin Git LFS).
- `blender/export.py` y `blender/denoise_lightmaps.mjs` — exportación a glTF y filtrado de los lightmaps horneados.
- `public/models/` — `turntable.glb`, `record.glb`, `room.glb` y `lightmaps/`, exportados desde Blender.
- `src/spotify/` — PKCE, Web API y Web Playback SDK.
- `src/deck/` — estado físico del tocadiscos, cinemática del brazo y sincronización con Spotify.
- `src/vinyl/` — reparto en caras, mapa surco ↔ canción y texturas generadas (surcos, etiqueta, funda).
- `src/audio/` — crackle, motor, aguja y surco final sintetizados con Web Audio.
- `src/scene/` — escena React Three Fiber, cámara sentada y calidad adaptativa.
- `src/scene/city/` — vista nocturna de Manhattan desde la cristalera: panorámica real, cielo procedural (luna, nubes, estrellas) y luces animadas.

## Créditos

Modelos y texturas de la habitación de [Poly Haven](https://polyhaven.com) (CC0): *Modern Wooden Cabinet* (Patrik Pangerl), *Modern Arm Chair 01* (Vibrant Nordic), *Potted Plant 02* (Rico Cilliers), *Herringbone Parquet*, *Plastered Wall 04*, *Wool Boucle*, *Oak Veneer 02*, *Ceramic Vase 01/02/03* (James Ray Cock), *Wooden Bowl 02* (Kuutti Siitonen).

Vista de la ciudad: [*Manhattan at night south of Rockefeller Center panorama*](https://commons.wikimedia.org/wiki/File:Manhattan_at_night_south_of_Rockefeller_Center_panorama_(11256p).jpg), de Rhododendrites, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); redimensionada a 4096 px (`public/city/manhattan-night.webp`), que se distribuye bajo la misma licencia.

Estantería: inspirada en el sistema Vitsoe 606 (Dieter Rams, 1960); proyecto personal sin relación con Vitsoe.

Altavoces: modelo inspirado en los Bang & Olufsen BeoLab 18; proyecto personal sin relación con Bang & Olufsen.

Cuadros: retratos de Kurt Cobain, Amy Winehouse y David Bowie de sus respectivos autores, usados como decoración en un proyecto personal.

Diseño del tocadiscos inspirado en el Braun PS 500 (Dieter Rams, 1969); proyecto personal sin relación con Braun.
