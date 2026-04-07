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
    
    # Helper to convert units to kg/ha
    def to_kgha(row):
        try:
            val = float(row['ValueS'])
            u = str(row['UnitS']).lower().strip()
            if u == 'g/ha': return val / 1000.0
            if u in ('mg/kg', 'mg/kg ds'): return val * 2.0
            if u == 'g/kg': return val * 2000.0
            if u == '%': return val * 20000.0
            if u == 'kg/l': return val * 1500000.0
            if u == 'mmol/l': return val * 30.0
            if u == 'g': return val / 1000.0
            return val
        except:
            return 0.0

    df['ValueS'] = df.apply(to_kgha, axis=1)
    df['UnitS'] = 'kg/ha'
    
    # Calculate days from start column
    df['days_from_start'] = (df['CreatedDate'] - df['CropStartDate']).dt.days
    
    # Rename for easier access
    df = df.rename(columns={'Plant/Crop': 'Crop'})
    
    # Aggregate to handle duplicates: by Crop, SoilType, CreatedDate, Measure
    agg_df = df.groupby(['Crop', 'SoilType', 'CreatedDate', 'Measure']).agg({
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
    
    # Pivot to format: { date: "...", Nitrogen: 50, Phosphorus: 20 }
    pivot_df = sub_df.pivot_table(
        index='CreatedDate', 
        columns='Measure', 
        values='ValueS', 
        aggfunc='mean'
    ).reset_index()
    
    pivot_df = pivot_df.sort_values('CreatedDate')
    pivot_df['date'] = pivot_df['CreatedDate'].dt.strftime('%Y-%m-%d %H:%M')
    
    # Drop original datetime col and replace NaNs with None for JSON compliance
    pivot_df = pivot_df.drop(columns=['CreatedDate'])
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
