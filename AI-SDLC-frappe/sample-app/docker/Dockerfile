# spice_lite on top of the official frappe_docker production image.
# frappe/erpnext:<tag> already contains a bench at /home/frappe/frappe-bench with frappe (+ erpnext,
# which we simply never install on the site). We only add our app to apps/.
ARG FRAPPE_IMAGE=frappe/erpnext:v15.121.5
FROM ${FRAPPE_IMAGE}

COPY --chown=frappe:frappe spice_lite /home/frappe/frappe-bench/apps/spice_lite

# Make `import spice_lite` work in the bench venv. This is exactly what an editable install does
# (a .pth entry), without needing network access during the build. With network you can use:
#   RUN /home/frappe/frappe-bench/env/bin/pip install --no-cache-dir -e /home/frappe/frappe-bench/apps/spice_lite
RUN SITE_PACKAGES="$(/home/frappe/frappe-bench/env/bin/python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')" \
 && echo /home/frappe/frappe-bench/apps/spice_lite > "$SITE_PACKAGES/spice_lite.pth" \
 && /home/frappe/frappe-bench/env/bin/python -c "import spice_lite, spice_lite.api.mappers; print('spice_lite', spice_lite.__version__)"
