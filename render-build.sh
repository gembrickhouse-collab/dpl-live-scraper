#!/usr/bin/env bash
# exit on error
set -o errexit

npm install

# Store Puppeteer cache in Render's build cache directory
STORAGE_DIR=/opt/render/project/.puppeteer
mkdir -p $STORAGE_DIR

npx puppeteer browsers install chrome

if [[ ! -d $STORAGE_DIR/chrome ]]; then
  echo "...Copying Puppeteer Cache to Build Cache"
  mkdir -p $STORAGE_DIR/chrome
  cp -R ~/.cache/puppeteer/chrome/* $STORAGE_DIR/chrome/
  
fi
