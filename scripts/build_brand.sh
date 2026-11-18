#!/bin/sh
# Rasterize the brand images of the integration from assets/brand/*.svg.
# Needs rsvg-convert (librsvg) and ImageMagick; the logos use the Inter font.
# Home Assistant 2026.3+ serves custom_components/house_view/brand/ by itself (no PR to home-assistant/brands).
set -eu
cd "$(dirname "$0")/.."
src=assets/brand
out=custom_components/house_view/brand
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

# write $1 resized to $2 as $3; same bytes at every run: no metadata, no timestamps
png() {
  convert "$1" -resize "$2" -strip -define png:compression-level=9 -define png:exclude-chunks=date,time "$3"
}

# icon: square, 256 px and 512 px (@2x); trimmed, then centred on a transparent square
rsvg-convert -w 2048 "$src/icon.svg" -o "$tmp/raw.png"
convert "$tmp/raw.png" -trim +repage -resize 1024x1024 -background none -gravity center -extent 1024x1024 "$tmp/icon.png"
png "$tmp/icon.png" 256x256 "$out/icon.png"
png "$tmp/icon.png" 512x512 "$out/icon@2x.png"

# logos: landscape, 256 px and 512 px (@2x) high, for light and dark backgrounds
for logo in logo dark_logo; do
  rsvg-convert -h 1024 "$src/$logo.svg" -o "$tmp/raw.png"
  convert "$tmp/raw.png" -trim +repage "$tmp/$logo.png"
  png "$tmp/$logo.png" x256 "$out/$logo.png"
  png "$tmp/$logo.png" x512 "$out/$logo@2x.png"
done
ls -l "$out"
