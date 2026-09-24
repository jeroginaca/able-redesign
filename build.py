#!/usr/bin/env python3
"""Inline CSS + JS into ABLE-standalone.html so the site opens by double-click (file://)."""
import re, pathlib
root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text()
css = (root / 'css/style.css').read_text()
land = (root / 'js/land.js').read_text()
main = (root / 'js/main.js').read_text()
land_const = re.search(r'export const LAND = ".*?";', land).group(0).replace('export ', '')
main = main.replace("import { LAND } from './land.js';", land_const)
html = re.sub(r'<link rel="stylesheet" href="css/style\.css(\?[^"]*)?">', lambda m: f'<style>\n{css}\n</style>', html)
html = re.sub(r'<script type="module" src="js/main\.js(\?[^"]*)?"></script>', lambda m: f'<script type="module">\n{main}\n</script>', html)
(root / 'ABLE-standalone.html').write_text(html)
print('wrote ABLE-standalone.html', len(html) // 1024, 'KB')
