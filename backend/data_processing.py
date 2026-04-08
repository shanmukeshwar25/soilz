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
    # Assuming formats like '08-04-2024 14:05' and '08-03-2024'
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
            return val # implicitly handles 'kg/ha'
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
    # Filter specific crop and soil combination
    sub_df = df[(df['Crop'] == crop) & (df['SoilType'] == soil)]
    
    if sub_df.empty:
        return []
    
    # Pivot to format, integrating BatchId to preserve distinct chronologic order of independent samples
    pivot_df = sub_df.pivot_table(
        index=['CreatedDate', 'BatchId', 'CropStartDate', 'CropEndDate', 'Crop', 'SoilType'], 
        columns='Measure', 
        values='ValueS', 
        aggfunc='first'
    ).reset_index()
    
    pivot_df = pivot_df.sort_values(['CreatedDate', 'BatchId'])
    
    # Form distinct string identifying date and sample batch for X axis/tooltips
    # We will pass the extra fields untouched; they will be part of the json payload
    pivot_df['date'] = pivot_df.apply(
        lambda row: f"{row['CreatedDate'].strftime('%Y-%m-%d %H:%M:%S')} (Batch {row['BatchId']})", 
        axis=1
    )
    
    # Stringify the lifecycle bounds
    pivot_df['CropStartDate'] = pivot_df['CropStartDate'].dt.strftime('%Y-%m-%d')
    pivot_df['CropEndDate'] = pivot_df['CropEndDate'].dt.strftime('%Y-%m-%d')
    
    # Drop internal cols
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
        
        unit_val = ""
        if 'UnitS' in group.columns and not group['UnitS'].dropna().empty:
            unit_val = str(group['UnitS'].dropna().iloc[0])
            if unit_val.lower() == 'nan': unit_val = ""
        
        summary.append({
            "measure": measure,
            "latest": last_val,
            "average": avg_val,
            "min": min_val,
            "max": max_val,
            "unit": unit_val
        })
        
    return summary

def get_date_range(crop: str, soil: str):
    """Return specific CropStartDate to CropEndDate combinations present in data."""
    df_raw = pd.read_csv(DATA_PATH)
    df_raw = df_raw.dropna(subset=['CropStartDate', 'CropEndDate'])
    df_raw['CropStartDate'] = pd.to_datetime(df_raw['CropStartDate'], dayfirst=True, errors='coerce')
    df_raw['CropEndDate']   = pd.to_datetime(df_raw['CropEndDate'],   dayfirst=True, errors='coerce')
    df_raw = df_raw.rename(columns={'Plant/Crop': 'Crop'})
    sub = df_raw[(df_raw['Crop'] == crop) & (df_raw['SoilType'] == soil)].dropna(subset=['CropStartDate','CropEndDate'])
    if sub.empty:
        return {"windows": []}
        
    windows = sub[['CropStartDate', 'CropEndDate']].drop_duplicates().sort_values('CropStartDate')
    
    out = []
    for _, row in windows.iterrows():
        out.append({
            "start": row['CropStartDate'].strftime('%Y-%m-%d'),
            "end": row['CropEndDate'].strftime('%Y-%m-%d')
        })
    return {"windows": out}
