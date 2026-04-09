import pandas as pd
import numpy as np
import os

DATA_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'sheet 2.csv')

# Global variable to hold the cached dataset
_cleaned_data = None

def _parse_dates(df, col_name, format_str=None):
    if format_str:
        return pd.to_datetime(df[col_name], format=format_str, errors='coerce')
    else:
        return pd.to_datetime(df[col_name], dayfirst=True, errors='coerce')

def load_and_clean_data(csv_path: str) -> pd.DataFrame:
    """Loads and preprocesses the soil dataset."""
    df = pd.read_csv(csv_path)
    
    # Drop rows where critical Date columns are missing
    df = df.dropna(subset=['CreatedDate', 'CropStartDate', 'CropEndDate', 'ValueS'])
    
    # Convert dates
    df['CreatedDate'] = pd.to_datetime(df['CreatedDate'], dayfirst=True, errors='coerce')
    df['CropStartDate'] = pd.to_datetime(df['CropStartDate'], dayfirst=True, errors='coerce')
    df['CropEndDate'] = pd.to_datetime(df['CropEndDate'], dayfirst=True, errors='coerce')
    
    # Remove unparseable dates
    df = df.dropna(subset=['CreatedDate', 'CropStartDate', 'CropEndDate'])
    
    # Filter strictly within crop lifecycle
    df = df[(df['CreatedDate'] >= df['CropStartDate']) & (df['CreatedDate'] <= df['CropEndDate'])]
    
    # Clean up UnitS format and strictly keep only 'kg/ha' or 'g/ha' elements
    df['UnitS'] = df['UnitS'].astype(str).str.lower().str.strip()
    df = df[df['UnitS'].isin(['kg/ha', 'g/ha'])]
    
    # Helper to calculate kg/ha precisely
    def to_kgha(row):
        try:
            val = float(row['ValueS'])
            u = row['UnitS']
            if u == 'g/ha': return val / 1000.0
            return val
        except:
            return 0.0

    df['ValueS'] = df.apply(to_kgha, axis=1)
    df['UnitS'] = 'kg/ha'
    
    # Calculate days from start column
    df['days_from_start'] = (df['CreatedDate'] - df['CropStartDate']).dt.days
    
    # Rename for easier access
    df = df.rename(columns={'Plant/Crop': 'Crop'})
    
    # Keep BatchId to uniquely identify samples tested on the same date
    if 'BatchId' not in df.columns:
        df['BatchId'] = 'Unknown'
    
    df['BatchId'] = df['BatchId'].fillna('Unknown')
    
    # Aggregate to handle exact measure duplicates within the SAME batch
    agg_df = df.groupby(['Crop', 'SoilType', 'CreatedDate', 'BatchId', 'CropStartDate', 'CropEndDate', 'Measure']).agg({
        'ValueS': 'mean'
    }).reset_index()
    
    # Sort properly
    agg_df = agg_df.sort_values(by='CreatedDate')
    
    return agg_df

def get_data() -> pd.DataFrame:
    global _cleaned_data
    if _cleaned_data is None:
        _cleaned_data = load_and_clean_data(DATA_PATH)
    return _cleaned_data

def get_filters():
    df = get_data()
    return {
        "crops": sorted(df['Crop'].dropna().unique().tolist()),
        "soil_types": sorted(df['SoilType'].dropna().unique().tolist()),
        "measures": sorted(df['Measure'].dropna().unique().tolist())
    }

def get_time_series_data(crop: str, soil: str):
    df = get_data()
    sub_df = df[(df['Crop'] == crop) & (df['SoilType'] == soil)]
    
    if sub_df.empty:
        return []
    
    pivot_df = sub_df.pivot_table(
        index=['CreatedDate', 'BatchId', 'CropStartDate', 'CropEndDate', 'Crop', 'SoilType'], 
        columns='Measure', 
        values='ValueS', 
        aggfunc='first'
    ).reset_index()
    
    pivot_df = pivot_df.sort_values(['CreatedDate', 'BatchId'])
    
    pivot_df['date'] = pivot_df.apply(
        lambda row: f"{row['CreatedDate'].strftime('%Y-%m-%d %H:%M:%S')} (Batch {row['BatchId']})", 
        axis=1
    )
    
    pivot_df['CropStartDate'] = pivot_df['CropStartDate'].dt.strftime('%Y-%m-%d')
    pivot_df['CropEndDate'] = pivot_df['CropEndDate'].dt.strftime('%Y-%m-%d')
    
    pivot_df = pivot_df.drop(columns=['CreatedDate', 'BatchId'])
    pivot_df = pivot_df.replace({np.nan: None})
    
    return pivot_df.to_dict(orient='records')

def get_summary_stats(crop: str, soil: str):
    df = get_data()
    sub_df = df[(df['Crop'] == crop) & (df['SoilType'] == soil)]
    
    if sub_df.empty:
        return []
        
    summary = []
    for measure, group in sub_df.groupby('Measure'):
        group_sorted = group.sort_values('CreatedDate')
        last_val = float(group_sorted.iloc[-1]['ValueS'])
        avg_val = float(group['ValueS'].mean())
        min_val = float(group['ValueS'].min())
        max_val = float(group['ValueS'].max())
        
        summary.append({
            "measure": measure,
            "latest": last_val,
            "average": avg_val,
            "min": min_val,
            "max": max_val,
            "unit": 'kg/ha'
        })
        
    return summary

def get_date_range(crop: str, soil: str):
    """
    Build Timeline Focus dropdown options grouped by calendar year of actual samples.

    Logic:
    - Read all rows for the given crop + soil combination.
    - Extract the year from each row's CreatedDate (the actual sample date).
    - Group rows by that year, computing min(CreatedDate) = first_sample
      and max(CreatedDate) = last_sample within the year.
    - Build a human-readable label: "Apr 2024 - Aug 2024"
      (first sample month/year  to  last sample month/year in that year).
    - Return one entry per year, sorted chronologically by first_sample.
    - The frontend uses first_sample..last_sample as the inclusive filter bounds.
    """
    df_raw = pd.read_csv(DATA_PATH)
    df_raw['CreatedDate']   = pd.to_datetime(df_raw['CreatedDate'],   dayfirst=True, errors='coerce')
    df_raw['CropStartDate'] = pd.to_datetime(df_raw['CropStartDate'], dayfirst=True, errors='coerce')
    df_raw['CropEndDate']   = pd.to_datetime(df_raw['CropEndDate'],   dayfirst=True, errors='coerce')
    df_raw = df_raw.rename(columns={'Plant/Crop': 'Crop'})

    sub = df_raw[
        (df_raw['Crop'] == crop) &
        (df_raw['SoilType'] == soil)
    ].dropna(subset=['CreatedDate'])

    if sub.empty:
        return {"windows": []}

    # Group by the calendar year of the actual sample CreatedDate
    sub = sub.copy()
    sub['sample_year'] = sub['CreatedDate'].dt.year

    yearly = (
        sub.groupby('sample_year')['CreatedDate']
        .agg(first_sample='min', last_sample='max')
        .reset_index()
        .sort_values('first_sample')
    )

    out = []
    for _, row in yearly.iterrows():
        fs = row['first_sample']
        ls = row['last_sample']
        # "Apr 2024 - Aug 2024"  (same year -> e.g. "Apr 2024 - Apr 2024" is fine too)
        label = f"{fs.strftime('%b %Y')} - {ls.strftime('%b %Y')}"
        out.append({
            "label":        label,
            "first_sample": fs.strftime('%Y-%m-%d %H:%M:%S'),
            "last_sample":  ls.strftime('%Y-%m-%d %H:%M:%S'),
            "year":         int(row['sample_year']),
        })

    return {"windows": out}
