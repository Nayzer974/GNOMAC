UUID := gnomac@nayzer974.github.io
SRC := extension/$(UUID)

.PHONY: install ez uninstall schemas zip nested logs check smoke map

install:
	./install.sh

ez:
	./ez-install.sh

uninstall:
	./uninstall.sh

schemas:
	glib-compile-schemas $(SRC)/schemas

# Package for extensions.gnome.org.
zip:
	gnome-extensions pack --force --extra-source=lib --extra-source=modules \
		--extra-source=icons --out-dir=dist $(SRC)

# Test inside a nested GNOME Shell window without logging out.
nested: install
	dbus-run-session gnome-shell --devkit --wayland

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

check:
	tools/check.sh

# Headless GNOME Shell with this checkout's extension, driven by a script.
smoke:
	tools/smoke-test.sh

# Regenerate docs/MAP.md and docs/map.json from the code (check.sh fails when they are stale).
map:
	python3 tools/gen-map.py
