#!/bin/bash
/opt/homebrew/bin/flyctl image show -a claudeclaw-impactworks 2>&1 | grep -oE 'GH_SHA=[a-f0-9]+' | head -1
