"""Cruza o CSV oficial da FCP com a malha municipal IBGE usada na prévia."""
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

folder = Path(__file__).resolve().parent
source = Path(sys.argv[1])
features = json.loads((folder / "municipios-BR.geojson").read_text(encoding="utf-8"))["features"]
municipalities = {str(feature["properties"]["CD_MUN"]) for feature in features}
codes = set()
unmatched = set()
without_code = 0
with source.open(encoding="utf-8-sig", newline="") as stream:
    reader = csv.DictReader(stream)
    reader.fieldnames = [value.strip() for value in reader.fieldnames]
    for row in reader:
        if not (row["COMUNIDADE"] or "").strip():
            continue
        recorded = set(re.findall(r"(?<!\d)\d{7}(?!\d)", row["CÓDIGO DO IBGE"] or ""))
        without_code += not recorded
        codes.update(recorded & municipalities)
        unmatched.update(recorded - municipalities)

if not codes:
    raise ValueError("Nenhum município do cadastro corresponde à malha IBGE.")
output = {
    "csvSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "unmatchedCodes": sorted(unmatched),
    "rowsWithoutCode": without_code,
    "municipalityCodes": sorted(codes),
}
(folder / "palmares-municipios.json").write_text(
    json.dumps(output, indent=2) + "\n", encoding="utf-8"
)
print(f"{len(codes)} municípios, {len(unmatched)} códigos sem correspondência, {without_code} registros sem código")
