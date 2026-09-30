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
- `src/scene/landscape/` — lo que se ve por la cristalera, a elegir entre dieciséis paisajes: Manhattan, campo, mar, futurista, postapocalíptico, la Luna, viejo oeste, medieval, ártico, volcánico, fantasía épica, bosque misterioso, antigüedad clásica, cyberpunk, steampunk y gótico. Cada uno es una panorámica real bajo un cielo procedural (luna, nubes, estrellas, humo) con su propia animación (tráfico, luciérnagas, oleaje, vehículos voladores, fuegos, la Tierra girando).
- `blender/landscapes.py` y `blender/landscapes_themes.py` — recortan y etalonan las panorámicas originales (en `sources/`, fuera del repo) a `public/landscapes/`, de noche y de día.
- `src/demo/` y `scripts/great78.py` — discos de demo sin cuenta: caras de 78 rpm de 1906 a 1925 del Great 78 Project (Internet Archive), agrupadas en cuatro LP con fundas hechas con las etiquetas fotografiadas de los discos. El audio se transmite desde archive.org; como las grabaciones ya traen su crepitado, el tocadiscos no añade el suyo.
- `blender/bake_day.py` — hornea los lightmaps de día (`arch_day`, `furn_day`): lámpara apagada y luz de día por la cristalera. El modo día funde entre los lightmaps de noche y los de día, y la lámpara se suma encima.

## Créditos

Modelos y texturas de la habitación de [Poly Haven](https://polyhaven.com) (CC0): *Modern Wooden Cabinet* (Patrik Pangerl), *Modern Arm Chair 01* (Vibrant Nordic), *Potted Plant 02* (Rico Cilliers), *Herringbone Parquet*, *Plastered Wall 04*, *Wool Boucle*, *Oak Veneer 02*, *Ceramic Vase 01/02/03* (James Ray Cock), *Wooden Bowl 02* (Kuutti Siitonen).

Paisajes de la ventana (`public/landscapes/`, recortados, redimensionados y etalonados; las obras derivadas de fotos CC BY-SA se distribuyen bajo la misma licencia):

- Manhattan: de noche, [*Manhattan at night south of Rockefeller Center panorama*](https://commons.wikimedia.org/wiki/File:Manhattan_at_night_south_of_Rockefeller_Center_panorama_(11256p).jpg), de Rhododendrites, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); de día, [*New York City Skyline from Top of the Rock, January 11 2026*](https://commons.wikimedia.org/wiki/File:New_York_City_Skyline_from_Top_of_the_Rock,_January_11_2026.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Campo: HDRI [*Clarens Night 01*](https://polyhaven.com/a/clarens_night_01) y [*Clarens Midday*](https://polyhaven.com/a/clarens_midday), de Poly Haven (CC0).
- Mar: cielos de los HDRI [*Kloppenheim 02 (Pure Sky)*](https://polyhaven.com/a/kloppenheim_02_puresky) y [*Kloppenheim 06 (Pure Sky)*](https://polyhaven.com/a/kloppenheim_06_puresky), de Poly Haven (CC0); el mar se genera en tiempo real.
- Futurista: [*Panorama of Chongqing at night taken from Eling Park*](https://commons.wikimedia.org/wiki/File:Panorama_of_Chongqing_at_night_taken_from_Eling_Park.jpeg) y [*Panorama of Chongqing from tower in Eling park*](https://commons.wikimedia.org/wiki/File:Panorama_of_Chongqing_from_tower_in_Eling_park.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Postapocalíptico: [*Pripyat panorama 2009-001*](https://commons.wikimedia.org/wiki/File:Pripyat_panorama_2009-001.jpg), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); etalonada al anochecer y a una calima de día, sin el cielo original.
- Luna: [*Apollo 17 Landing Site Panorama during EVA1*](https://commons.wikimedia.org/wiki/File:Apollo_17_Landing_Site_Panorama_during_EVA1_JSC2007e045384.jpg), NASA (dominio público). La Tierra: *Blue Marble* de NASA Visible Earth (dominio público).
- Viejo Oeste: [*Monument Valley Panorama*](https://commons.wikimedia.org/wiki/File:Monument_Valley_Panorama.jpg), de Michaelbleicher, CC BY-SA 4.0.
- Medieval: [*Panorama de la Cité de Carcassonne*](https://commons.wikimedia.org/wiki/File:Panorama_de_la_Cit%C3%A9_de_Carcassonne-20190903.jpg), de Daniel Villafruela, CC BY-SA 4.0.
- Ártico: [*Daudmannsflya Lexfjellet panorama*](https://commons.wikimedia.org/wiki/File:Daudmannsflya_Lexfjellet_panorama.JPG), de Bjoertvedt, CC BY-SA 3.0.
- Volcánico: [*Holuhraun Fissure Eruption in Iceland*](https://commons.wikimedia.org/wiki/File:Holuhraun_Fissure_Eruption_in_Iceland_-_September_2014.jpg), de Robert Askew, CC BY-SA 3.0.
- Fantasía épica: [*The Old Man of Storr – Panorama*](https://commons.wikimedia.org/wiki/File:The_old_man_of_Storr_-_Panorama.jpg), de Xavier St-Gelais, CC BY-SA 4.0.
- Bosque misterioso: HDRI [*Misty Pines*](https://polyhaven.com/a/misty_pines), de Poly Haven (CC0).
- Antigüedad clásica: HDRI [*Colosseum*](https://polyhaven.com/a/colosseum), de Poly Haven (CC0).
- Cyberpunk: [*Lion Rock panorama 2018*](https://commons.wikimedia.org/wiki/File:1_lion_rock_panorama_2018.jpg), de Chensiyuan, CC BY-SA 4.0, y [*Hong Kong from Lion Rock*](https://commons.wikimedia.org/wiki/File:Hong_Kong_from_Lion_Rock.JPG), de Fredlyfish4, CC BY-SA 3.0.
- Steampunk: HDRI [*Hamburg Canal*](https://polyhaven.com/a/hamburg_canal), de Poly Haven (CC0).
- Gótico: [*Panorama Prague Castle 2014*](https://commons.wikimedia.org/wiki/File:Panorama-prague-castle-2014.jpg), de Jan Rybář (fotoguru.cz), CC BY-SA 3.0.

Salvo en Manhattan, Mar y Futurista, la noche se obtiene de la misma foto de día (noche americana: exposición, color y cielo nocturno generado), así que día y noche muestran exactamente el mismo sitio. Dragones, dirigibles, aves, murciélagos, estepicursores, hologramas, chispas de lava, auroras, niebla y fuegos fatuos se generan en tiempo real.

Discos de demo: grabaciones del [Great 78 Project](https://great78.archive.org/) del Internet Archive, publicadas en 1925 o antes (dominio público en EE. UU.); el audio se escucha directamente desde archive.org y las fundas (`public/demo/`) usan las fotos de las etiquetas de esos discos.

Estantería: inspirada en el sistema Vitsoe 606 (Dieter Rams, 1960); proyecto personal sin relación con Vitsoe.

Altavoces: modelo inspirado en los Bang & Olufsen BeoLab 18; proyecto personal sin relación con Bang & Olufsen.

Cuadros: retratos de Kurt Cobain, Amy Winehouse y David Bowie de sus respectivos autores, usados como decoración en un proyecto personal.

Diseño del tocadiscos inspirado en el Braun PS 500 (Dieter Rams, 1969); proyecto personal sin relación con Braun.
