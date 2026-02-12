import os
import re
import sys
import pandas as pd
from sqlalchemy import create_engine, text
import urllib.parse
import unicodedata

# ================== CONFIG ==================
EXCEL_ROOT = r"C:\\Users\\vlad.puschiulescu\\Desktop\\New folder (2)"

SERVER   = "ndelodev03"
DATABASE = "Lucru_EON"
SCHEMA   = "dbo"

TARGET_TABLE  = "arh_istoric_arhiva_documente"
STAGING_TABLE = TARGET_TABLE + "__staging"

TRUSTED_CONNECTION = False
USER = "elodb"
PASSWORD = "elodb"

RECURSE = True
CHUNK_SIZE = 20000

TRUNCATE_STAGING_BEFORE_LOAD = True  # recommended so each run is clean
# ===========================================

try:
    import pyodbc
except ImportError:
    print("pyodbc is not installed. Run: pip install pyodbc")
    sys.exit(1)

PREFERRED_DRIVERS = [
    "ODBC Driver 18 for SQL Server",
    "ODBC Driver 17 for SQL Server",
    "SQL Server"
]

# ---------- DB helpers ----------

def pick_driver():
    drivers = pyodbc.drivers()
    for d in PREFERRED_DRIVERS:
        if d in drivers:
            return d
    raise RuntimeError(f"No suitable SQL Server ODBC driver found. Installed: {drivers}")

def make_engine():
    driver = pick_driver()
    if TRUSTED_CONNECTION:
        params = (
            f"DRIVER={{{driver}}};"
            f"SERVER={SERVER};DATABASE={DATABASE};"
            f"Trusted_Connection=Yes;"
            f"Encrypt=Yes;TrustServerCertificate=Yes;"
        )
    else:
        params = (
            f"DRIVER={{{driver}}};"
            f"SERVER={SERVER};DATABASE={DATABASE};"
            f"UID={USER};PWD={PASSWORD};"
            f"Encrypt=Yes;TrustServerCertificate=Yes;"
        )
    odbc_connect = urllib.parse.quote(params)
    return create_engine(f"mssql+pyodbc:///?odbc_connect={odbc_connect}", fast_executemany=True)

def ensure_staging_like_target(engine, schema, target_table, staging_table):
    """
    Creates staging table with same schema as target if missing.
    Copies structure only (TOP 0).
    """
    sql = f"""
IF OBJECT_ID(N'{schema}.{staging_table}', N'U') IS NULL
BEGIN
    SELECT TOP (0) *
    INTO [{schema}].[{staging_table}]
    FROM [{schema}].[{target_table}];
END
"""
    with engine.begin() as conn:
        conn.execute(text(sql))

# ---------- Excel helpers ----------

def iter_excel_files(root, recurse=True):
    if recurse:
        for dp, _, files in os.walk(root):
            for f in files:
                if f.lower().endswith((".xlsx", ".xlsm", ".xls")):
                    yield os.path.join(dp, f)
    else:
        for f in os.listdir(root):
            p = os.path.join(root, f)
            if os.path.isfile(p) and f.lower().endswith((".xlsx", ".xlsm", ".xls")):
                yield p

def normalize_header_name(name: str) -> str:
    """Normalize header for robust matching (diacritics, spaces, punctuation, case)."""
    if not isinstance(name, str):
        name = str(name)

    name = unicodedata.normalize("NFKD", name)
    name = "".join(ch for ch in name if unicodedata.category(ch) != "Mn")

    name = name.strip().lower()
    name = re.sub(r"\s+", " ", name)
    name = re.sub(r"[^0-9a-z ]+", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name

def strip_diacritics_value(x):
    if not isinstance(x, str):
        return x
    trans = str.maketrans({
        "ș": "s", "ş": "s", "Ș": "S", "Ş": "S",
        "ț": "t", "ţ": "t", "Ț": "T", "Ţ": "T",
        "ă": "a", "Ă": "A", "â": "a", "Â": "A", "î": "i", "Î": "I"
    })
    x = unicodedata.normalize("NFKD", x)
    x = "".join(ch for ch in x if unicodedata.category(ch) != "Mn")
    x = x.translate(trans)
    x = re.sub(r"\s+", " ", x).strip()
    return x

def strip_diacritics_df(df: pd.DataFrame) -> pd.DataFrame:
    return df.applymap(strip_diacritics_value)

def strip_diacritics_df(df: pd.DataFrame) -> pd.DataFrame:
    return df.applymap(strip_diacritics_value)

TIP_CONTRACT_RE = re.compile(r"\b(CASNIC|NONCASNIC)\b", re.IGNORECASE)

def extract_tip_contract_from_tip_produs(tip_produs: str):
    """
    Extract CASNIC / NONCASNIC from Tip_Produs, return (tip_contract, cleaned_tip_produs).
    If not found, returns (None, original).
    """
    if not isinstance(tip_produs, str) or not tip_produs.strip():
        return None, tip_produs

    m = TIP_CONTRACT_RE.search(tip_produs)
    if not m:
        return None, tip_produs

    tip_contract = m.group(1).upper()
    cleaned = TIP_CONTRACT_RE.sub(" ", tip_produs, count=1)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return tip_contract, cleaned

def build_mapped_frame(df: pd.DataFrame) -> pd.DataFrame:
    """
    Build DataFrame for SQL insert (WITHOUT uuid).
    Columns:
      skp, Localitate, Tip_Produs, an_creare, Tip_contract,
      cod_cutie_obiect, cod_obiect
    """
    norm_map = {}
    for c in df.columns:
        n = normalize_header_name(c)
        if n not in norm_map:
            norm_map[n] = c

    def col(*candidates):
        for cand in candidates:
            key = normalize_header_name(cand)
            if key in norm_map:
                return norm_map[key]
        return None

    c_skp        = col("SKP")
    c_localitate = col("localitate")
    c_tip_excel  = col("tip")  # optional
    c_tip_produs = col("tip contract", "tip_contract", "tip produs", "tip produs/contract")
    c_an         = col("AN", "an")

    # NEW columns
    c_cutie_mare = col("CUTIE MARE", "cutie mare")
    c_cutie_mica = col("cutie mica", "CUTIE MICA")

    out = pd.DataFrame({
        "skp":             df[c_skp] if c_skp else pd.NA,
        "Localitate":      df[c_localitate] if c_localitate else pd.NA,
        "Tip_Produs":      df[c_tip_produs] if c_tip_produs else pd.NA,
        "an_creare":       df[c_an] if c_an else pd.NA,
        "Tip_contract":    pd.NA,

        # NEW mapped SQL columns
        "cod_cutie_obiect": df[c_cutie_mare] if c_cutie_mare else pd.NA,
        "cod_obiect":       df[c_cutie_mica] if c_cutie_mica else pd.NA,
    })

    # strings (include the new ones)
    for k in ["skp", "Localitate", "Tip_Produs", "Tip_contract", "cod_cutie_obiect", "cod_obiect"]:
        out[k] = out[k].astype("string")

    # Tip_contract logic
    if c_tip_excel:
        out["Tip_contract"] = df[c_tip_excel].astype("string")
    else:
        extracted = out["Tip_Produs"].apply(lambda v: extract_tip_contract_from_tip_produs(v))
        out["Tip_contract"] = extracted.apply(lambda t: t[0]).astype("string")
        out["Tip_Produs"]   = extracted.apply(lambda t: t[1]).astype("string")

    # cleanup whitespace (include the new ones)
    for k in ["skp", "Localitate", "Tip_Produs", "Tip_contract", "cod_cutie_obiect", "cod_obiect"]:
        out[k] = out[k].apply(lambda v: re.sub(r"\s+", " ", v).strip() if isinstance(v, str) else v)

    out = out.where(~out.isna(), None)
    out = out.dropna(how="all")
    return out


# ---------- main ----------

def main():
    if not os.path.isdir(EXCEL_ROOT):
        print(f"ERROR: Excel folder not found: {EXCEL_ROOT}")
        sys.exit(1)

    files = list(iter_excel_files(EXCEL_ROOT, RECURSE))
    if not files:
        print(f"No Excel files found under: {EXCEL_ROOT}")
        sys.exit(0)

    print(f"Found {len(files)} Excel file(s).")
    engine = make_engine()

    with engine.connect() as c:
        dbname = c.execute(text("SELECT DB_NAME()")).scalar()
        print("Connected to DB:", dbname)
        if dbname != DATABASE:
            print("WARNING: You are not in the expected database. Check SERVER/DATABASE settings.")

    # staging exists
    ensure_staging_like_target(engine, SCHEMA, TARGET_TABLE, STAGING_TABLE)

    # wipe staging
    if TRUNCATE_STAGING_BEFORE_LOAD:
        with engine.begin() as conn:
            conn.execute(text(f"TRUNCATE TABLE [{SCHEMA}].[{STAGING_TABLE}]"))
        print("Staging table truncated.")

    total_rows = 0

    for ix, path in enumerate(files, 1):
        try:
            ext = os.path.splitext(path)[1].lower()
            engine_name = "openpyxl" if ext in [".xlsx", ".xlsm"] else "xlrd"

            with pd.ExcelFile(path, engine=engine_name) as xf:
                for sheet in xf.sheet_names:
                    try:
                        df = pd.read_excel(xf, sheet_name=sheet, dtype=str)
                        if df.empty:
                            continue

                        df = strip_diacritics_df(df)
                        insert_df = build_mapped_frame(df)
                        if insert_df.empty:
                            continue

                        # IMPORTANT: do NOT include uuid column; SQL default generates it
                        insert_df.to_sql(
                            name=STAGING_TABLE,
                            con=engine,
                            schema=SCHEMA,
                            if_exists="append",
                            index=False,
                            chunksize=CHUNK_SIZE
                        )

                        total_rows += len(insert_df)
                        print(f"[{ix}/{len(files)}] {os.path.basename(path)} • {sheet}: {len(insert_df):,} rows")
                    except Exception as e_sheet:
                        print(f"   ! Sheet '{sheet}' failed: {e_sheet}")
        except Exception as e_file:
            print(f"! Failed to open {path}: {e_file}")

    print(f"DONE. Inserted ~{total_rows:,} rows into {DATABASE}.{SCHEMA}.{STAGING_TABLE}")

if __name__ == "__main__":
    main()
