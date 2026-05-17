# SplatDoc

Toy-sized, static WebGPU diagnostic viewer for Gaussian splats.

Live site: https://lolney.github.io/splatdoc/

## Features

- Load local `.ply` and `.splat` files in the browser
- Interactive splat viewport with WebGPU and CPU canvas fallback
- Diagnostic views for opacity, density, overdraw, projected size, floaters, dead splats, blur/soup risk, and simplification preview
- Per-view estimate, distribution summary, and camera stress-path shortcuts

## Development

```sh
npm install
npm run dev
```

## Checks

```sh
npm run build
npm run build:pages
npm test
npm run test:e2e
```
