# Publicar una versión de KeyPing con actualizaciones firmadas

Desde la 1.3.0, KeyPing solo acepta una actualización automática si su `latest.yml` (Windows) o
`latest-linux.yml` (Linux) lleva una firma Ed25519 válida de una de las claves de
`keyping-ui/electron/updates/update-public-keys.ts`. La firma cubre la versión y, de cada
instalador, el nombre, el tamaño y el SHA-512. Si falta o no cuadra, la app no descarga nada y
muestra «La actualización no tiene una firma válida de KeyPing».

La clave privada **nunca** va a GitHub (ni al repositorio, ni a Secrets, ni a Actions).

## Una sola vez: crear la clave

En tu equipo, dentro de `keyping-ui`:

```bash
npm run update:keygen
```

- Pide una frase de paso (mínimo 12 caracteres) y guarda la clave privada cifrada en
  `~/.keyping-signing/update-ed25519.pem` (en Windows, `C:\Users\<tú>\.keyping-signing\`).
  Otra ruta: variable `KEYPING_UPDATE_KEY`.
- Añade la clave pública a `electron/updates/update-public-keys.ts`. Haz commit de ese archivo.
- **Copia de seguridad**: guarda el `.pem` y la frase en dos sitios distintos fuera del equipo
  (por ejemplo, un USB cifrado y tu gestor de contraseñas). Si la pierdes, las versiones
  instaladas ya no aceptarán actualizaciones y habrá que reinstalar a mano.

Si `update-public-keys.ts` está vacío, `electron-builder` se niega a empaquetar.
Para una compilación de pruebas: `KEYPING_ALLOW_NO_UPDATE_KEY=1` (esa build nunca se actualizará).

## En cada versión

1. Sube la versión en `keyping-ui/package.json` y `package-lock.json`, commit, tag `vX.Y.Z`.
2. **Windows** (en tu equipo): `npm run build`. Después firma el yml junto al instalador:
   ```powershell
   npm run update:sign -- dist/build/latest.yml
   ```
   El script comprueba antes que `KeyPing-Setup-X.Y.Z.exe` de `dist/build` coincide en tamaño y
   SHA-512 con el yml. Sube a la release el `.exe`, el `.exe.blockmap`, el `latest.yml` **firmado**,
   `SHA256SUMS.txt` y `SHA256SUMS.txt.asc`.
3. **Linux** (Actions, al empujar el tag): el workflow sube el AppImage a la release, pero el
   `latest-linux.yml` lo deja como artefacto del workflow (`latest-linux-unsigned`), porque no
   puede firmarlo. En tu equipo:
   ```bash
   mkdir rel && cd rel
   RUN=$(gh run list --repo Zulaa9/KeyPing --workflow release-linux.yml --limit 1 --json databaseId -q '.[0].databaseId')
   gh run download "$RUN" --repo Zulaa9/KeyPing --name latest-linux-unsigned
   gh release download vX.Y.Z --repo Zulaa9/KeyPing --pattern 'KeyPing-*.AppImage'
   cd ../keyping-ui && npm run update:sign -- ../rel/latest-linux.yml
   gh release upload vX.Y.Z ../rel/latest-linux.yml --repo Zulaa9/KeyPing --clobber
   ```
   La firma solo se hace si el AppImage descargado coincide con el yml.
4. Comprueba lo publicado: descarga los dos yml de la release y
   `npm run update:verify -- latest.yml latest-linux.yml` → debe decir `OK` en ambos.

Mientras el yml no esté subido firmado, las instalaciones 1.3.0+ simplemente no ven la
actualización como instalable (muestran el aviso de firma); no hay riesgo.

## Rotar la clave

1. Con `KEYPING_UPDATE_KEY` apuntando a una ruta nueva, `npm run update:keygen`: se añade la
   clave nueva junto a la antigua.
2. Publica una versión firmada con la clave **antigua** (todas las instalaciones la aceptan y
   reciben la nueva clave pública).
3. A partir de ahí firma con la nueva y, una o dos versiones después, quita la antigua de
   `update-public-keys.ts`.

Si la clave privada se filtra: publica cuanto antes una versión firmada con ella que solo
confíe en una clave nueva, y avisa en el README de la release.

## Límites

- Las instalaciones 1.2.1 o anteriores no comprueban firmas: la 1.3.0 les llega como hasta ahora.
- La firma protege la actualización automática. Quien descargue el instalador a mano debe seguir
  comprobando `SHA256SUMS.txt` y su firma GPG.
- El instalador de Windows sigue sin firma Authenticode (SmartScreen avisará).
