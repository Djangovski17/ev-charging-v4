"use client";

import { useState, useEffect } from "react";
import axios from "axios";

interface Connector {
  id: string;
  type: string;
  powerKw: number;
  status: string;
  pricePerKwh: number;
  createdAt: string;
  updatedAt: string;
}

interface Station {
  id: string;
  name: string;
  status: string;
  connectorType: string;
  pricePerKwh: number;
  address: string | null;
  city: string | null;
  connectors: Connector[];
  createdAt: string;
  updatedAt: string;
}

export default function StationsPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedStations, setExpandedStations] = useState<Set<string>>(new Set());
  const [editingPrice, setEditingPrice] = useState<{ connectorId: string; value: string } | null>(null);
  const [updatingConnector, setUpdatingConnector] = useState<Set<string>>(new Set());

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

  const toggleStation = (stationId: string) => {
    const newExpanded = new Set(expandedStations);
    if (newExpanded.has(stationId)) {
      newExpanded.delete(stationId);
    } else {
      newExpanded.add(stationId);
    }
    setExpandedStations(newExpanded);
  };

  const handlePriceEdit = (connectorId: string, currentPrice: number) => {
    setEditingPrice({ connectorId, value: currentPrice.toFixed(2) });
  };

  const handlePriceSave = async (connectorId: string) => {
    if (!editingPrice || editingPrice.connectorId !== connectorId) return;

    const newPrice = parseFloat(editingPrice.value);
    if (isNaN(newPrice) || newPrice <= 0) {
      alert("Cena musi być liczbą większą od 0");
      setEditingPrice(null);
      return;
    }

    setUpdatingConnector((prev) => new Set(prev).add(connectorId));
    try {
      await axios.put(`${API_URL}/admin/connectors/${connectorId}`, {
        pricePerKwh: newPrice,
      });
      await fetchStations();
      setEditingPrice(null);
    } catch (error) {
      console.error("Error updating connector price:", error);
      alert("Błąd podczas aktualizacji ceny");
    } finally {
      setUpdatingConnector((prev) => {
        const newSet = new Set(prev);
        newSet.delete(connectorId);
        return newSet;
      });
    }
  };

  const handlePriceCancel = () => {
    setEditingPrice(null);
  };

  const handleStatusChange = async (connectorId: string, newStatus: string) => {
    setUpdatingConnector((prev) => new Set(prev).add(connectorId));
    try {
      await axios.put(`${API_URL}/admin/connectors/${connectorId}`, {
        status: newStatus,
      });
      await fetchStations();
    } catch (error) {
      console.error("Error updating connector status:", error);
      alert("Błąd podczas aktualizacji statusu");
    } finally {
      setUpdatingConnector((prev) => {
        const newSet = new Set(prev);
        newSet.delete(connectorId);
        return newSet;
      });
    }
  };

  const getStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      AVAILABLE: "Dostępne",
      CHARGING: "Ładowanie",
      OCCUPIED: "Zajęte",
      UNAVAILABLE: "Niedostępne",
      PENDING: "Oczekuje",
      COMPLETED: "Zakończone",
      FAILED: "Nieudane",
      FAULTED: "Awaria",
    };
    return statusMap[status] || status;
  };

  const getStatusColor = (status: string) => {
    if (status === "AVAILABLE") {
      return "bg-green-100 text-green-800";
    } else if (status === "CHARGING" || status === "OCCUPIED" || status === "PENDING") {
      return "bg-blue-100 text-blue-800";
    } else if (status === "UNAVAILABLE" || status === "FAILED" || status === "FAULTED") {
      return "bg-red-100 text-red-800";
    } else if (status === "COMPLETED") {
      return "bg-slate-100 text-slate-800";
    }
    return "bg-slate-100 text-slate-800";
  };

  const getConnectorName = (connector: Connector, index: number) => {
    // Można użyć ID lub indeksu, lub dodać pole name do schematu
    return `Złącze ${String.fromCharCode(65 + index)}`; // A, B, C, ...
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
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider w-8">
                    {/* Kolumna na ikonę rozwijania */}
                  </th>
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
                {stations.map((station) => {
                  const isExpanded = expandedStations.has(station.id);
                  return (
                    <>
                      <tr
                        key={station.id}
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => toggleStation(station.id)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                          <svg
                            className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </td>
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
                            onClick={(e) => {
                              e.stopPropagation();
                              // TODO: Implementacja edycji
                              alert(`Edycja stacji ${station.id}`);
                            }}
                          >
                            Edytuj
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} className="px-0 py-0 bg-slate-50">
                            <div className="px-6 py-4">
                              <h3 className="text-sm font-semibold text-slate-700 mb-3">
                                Złącza stacji ({station.connectors.length})
                              </h3>
                              {station.connectors.length === 0 ? (
                                <p className="text-sm text-slate-500">Brak złączy dla tej stacji.</p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full border border-slate-200 rounded-lg">
                                    <thead className="bg-slate-100">
                                      <tr>
                                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                                          ID / Nazwa
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                                          Typ
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                                          Moc (kW)
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                                          Cena (zł/kWh)
                                        </th>
                                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                                          Status
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-slate-200">
                                      {station.connectors.map((connector, index) => {
                                        const isEditingPrice =
                                          editingPrice?.connectorId === connector.id;
                                        const isUpdating = updatingConnector.has(connector.id);
                                        return (
                                          <tr
                                            key={connector.id}
                                            className="hover:bg-slate-50 transition-colors"
                                          >
                                            <td className="px-4 py-3 text-sm text-slate-700">
                                              <div className="font-medium">{getConnectorName(connector, index)}</div>
                                              <div className="text-xs text-slate-500 mt-1">{connector.id}</div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-700">
                                              {connector.type}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-700">
                                              {connector.powerKw} kW
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-700">
                                              {isEditingPrice ? (
                                                <div className="flex items-center gap-2">
                                                  <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0.01"
                                                    value={editingPrice.value}
                                                    onChange={(e) =>
                                                      setEditingPrice({
                                                        ...editingPrice,
                                                        value: e.target.value,
                                                      })
                                                    }
                                                    className="w-24 px-2 py-1 border border-slate-300 rounded text-sm"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Enter") {
                                                        handlePriceSave(connector.id);
                                                      } else if (e.key === "Escape") {
                                                        handlePriceCancel();
                                                      }
                                                    }}
                                                  />
                                                  <button
                                                    onClick={() => handlePriceSave(connector.id)}
                                                    disabled={isUpdating}
                                                    className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                                                  >
                                                    ✓
                                                  </button>
                                                  <button
                                                    onClick={handlePriceCancel}
                                                    className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                                                  >
                                                    ✕
                                                  </button>
                                                </div>
                                              ) : (
                                                <div className="flex items-center gap-2">
                                                  <span>{connector.pricePerKwh.toFixed(2)} zł</span>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handlePriceEdit(connector.id, connector.pricePerKwh);
                                                    }}
                                                    disabled={isUpdating}
                                                    className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded disabled:opacity-50"
                                                    title="Edytuj cenę"
                                                  >
                                                    ✏️
                                                  </button>
                                                </div>
                                              )}
                                            </td>
                                            <td className="px-4 py-3 text-sm">
                                              <select
                                                value={connector.status}
                                                onChange={(e) => {
                                                  e.stopPropagation();
                                                  handleStatusChange(connector.id, e.target.value);
                                                }}
                                                disabled={isUpdating}
                                                className={`px-3 py-1 text-xs font-semibold rounded-full border-0 ${getStatusColor(
                                                  connector.status
                                                )} cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                <option value="AVAILABLE">Dostępne</option>
                                                <option value="CHARGING">Ładowanie</option>
                                                <option value="FAULTED">Awaria</option>
                                                <option value="UNAVAILABLE">Niedostępne</option>
                                                <option value="OCCUPIED">Zajęte</option>
                                              </select>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
