import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000';

export const getFilters = async () => {
  const response = await axios.get(`${API_BASE_URL}/filters`);
  return response.data;
};

export const getTimeSeriesData = async (crop, soil) => {
  const response = await axios.get(`${API_BASE_URL}/data`, {
    params: { crop, soil },
  });
  return response.data.data;
};

export const getSummaryStats = async (crop, soil) => {
  const response = await axios.get(`${API_BASE_URL}/summary`, {
    params: { crop, soil },
  });
  return response.data.summary;
};
