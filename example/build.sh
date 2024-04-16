#!/bin/bash

tsc --module commonjs --outDir dist

browserify nabtoModule.js -o nabtoBundle.js

