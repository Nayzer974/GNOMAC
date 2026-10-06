UUID := gnomac@nayzer974.github.io
SRC := extension/$(UUID)

.PHONY: install ez uninstall schemas zip nested logs

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
