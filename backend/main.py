from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import data_processing

app = FastAPI(title="Soil Nutrient API")

# Configure CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    # Pre-load data into memory when API starts
    data_processing.get_data()

@app.get("/filters")
def get_filters():
    try:
        return data_processing.get_filters()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/data")
def get_data(crop: str = Query(..., description="Crop Name"), soil: str = Query(..., description="Soil Type")):
    try:
        data = data_processing.get_time_series_data(crop, soil)
        return {"data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/summary")
def get_summary(crop: str = Query(..., description="Crop Name"), soil: str = Query(..., description="Soil Type")):
    try:
        summary = data_processing.get_summary_stats(crop, soil)
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/date-range")
def get_date_range(crop: str = Query(...), soil: str = Query(...)):
    try:
        return data_processing.get_date_range(crop, soil)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
