# palomitas

Catálogo de películas y series con estilo de plataforma de streaming, hecho con HTML, CSS y JavaScript. Solo muestra información, no reproduce nada.

- Pósters, géneros, búsqueda, recién agregados y títulos nuevos desde la última actualización del catálogo.
- Sinopsis, reparto, calificación TMDB y dónde ver (datos de JustWatch vía TMDB) con una clave de API de TMDB.
- Calificaciones de IMDb, Rotten Tomatoes y Metacritic con una clave de API de OMDb.
- Navegación con flechas del control remoto, lista para empaquetar como app de LG webOS (`appinfo.json`).

Las claves se capturan en **Ajustes** y se guardan solo en el navegador o TV donde se usan.

## Uso local

```bash
python3 -m http.server 8080
```

Y abrir http://localhost:8080
