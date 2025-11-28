"use client";

import { useState, useEffect } from "react";
import axios from "axios";

interface Station {
  id: string;
  name: string;
  status: string;
  connectorType: string;
  pricePerKwh: number;
  address: string | null;
  city: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function StationsPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

  useEffect(() => {
    fetchStations();
  }, []);

  const fetchStations = async () => {
    setIsLoading(true);
    try {
      const response = await axios.get(`${API_URL}/admin/stations`);
      setStations(response.data);
    } catch (error) {
      console.error("Error fetching stations:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      AVAILABLE: "Dostępna",
      CHARGING: "Ładowanie",
      OCCUPIED: "Zajęta",
      UNAVAILABLE: "Niedostępna",
      PENDING: "Oczekuje",
      COMPLETED: "Zakończona",
      FAILED: "Nieudana",
    };
    return statusMap[status] || status;
  };

  const getStatusColor = (status: string) => {
    if (status === "AVAILABLE") {
      return "bg-green-100 text-green-800";
    } else if (status === "CHARGING" || status === "OCCUPIED" || status === "PENDING") {
      return "bg-blue-100 text-blue-800";
    } else if (status === "UNAVAILABLE" || status === "FAILED") {
      return "bg-red-100 text-red-800";
    } else if (status === "COMPLETED") {
      return "bg-slate-100 text-slate-800";
    }
    return "bg-slate-100 text-slate-800";
  };

  return (
    <div>
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Stacje</h1>
      {isLoading ? (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-12 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600"></div>
          <p className="mt-4 text-slate-600">Ładowanie stacji...</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          {stations.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <p>Brak stacji w bazie danych.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Nazwa
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Adres
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Miasto
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Cena (zł/kWh)
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Akcje
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {stations.map((station) => (
                  <tr key={station.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                      {station.id}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                      {station.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                      {station.address || "-"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                      {station.city || "-"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                          station.status
                        )}`}
                      >
                        {getStatusLabel(station.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                      {station.pricePerKwh.toFixed(2)} zł
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        className="px-4 py-2 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors"
                        onClick={() => {
                          // TODO: Implementacja edycji
                          alert(`Edycja stacji ${station.id}`);
                        }}
                      >
                        Edytuj
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

