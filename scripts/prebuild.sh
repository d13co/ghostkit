#!/usr/bin/env sh

cd -- "$(dirname -- "$0")" || exit 1

mkdir -p artifacts

cp  ../../smart_contracts/artifacts/ghostofavm/Ghostofavm.arc56.json artifacts/

npx @algorandfoundation/algokit-client-generator generate -o artifacts/GhostofavmClient.ts -a artifacts/Ghostofavm.arc56.json

