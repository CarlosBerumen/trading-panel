"""Descarga el informe semanal en PDF y guarda su texto. Solo acepta direcciones de J.P. Morgan Asset Management."""
import io
import sys
import urllib.request

PERMITIDO = "https://am.jpmorgan.com/"


def descargar(url, limite=15_000_000):
    if not url.startswith(PERMITIDO):
        raise ValueError("direccion no permitida")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (panel personal de analisis)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        datos = r.read(limite + 1)
    if len(datos) > limite or not datos.startswith(b"%PDF"):
        raise ValueError("no es un PDF valido")
    return datos


def texto(datos):
    from pypdf import PdfReader
    return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(datos)).pages)


if __name__ == "__main__":
    url, salida = sys.argv[1], sys.argv[2]
    open(salida, "w", encoding="utf-8").write(texto(descargar(url)))
