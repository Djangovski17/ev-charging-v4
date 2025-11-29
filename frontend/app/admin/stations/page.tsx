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
  latitude: number | null;
  longitude: number | null;
  connectors: Connector[];
  createdAt: string;
  updatedAt: string;
}

export default function StationsPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedStations, setExpandedStations] = useState<Set<string>>(new Set());
  const [editingPrice, setEditingPrice] = useState<{ connectorId: string; value: string } | null>(null);
  const [editingType, setEditingType] = useState<{ connectorId: string; value: string } | null>(null);
  const [editingPower, setEditingPower] = useState<{ connectorId: string; value: string } | null>(null);
  const [updatingConnector, setUpdatingConnector] = useState<Set<string>>(new Set());
  const [editingStation, setEditingStation] = useState<Station | null>(null);
  const [isUpdatingStation, setIsUpdatingStation] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

  const handleTypeEdit = (connectorId: string, currentType: string) => {
    setEditingType({ connectorId, value: currentType });
  };

  const handleTypeSave = async (e: React.FormEvent, connectorId: string) => {
    e.preventDefault();
    if (!editingType || editingType.connectorId !== connectorId) return;

    const newType = editingType.value.trim();
    if (!newType) {
      alert("Typ złącza nie może być pusty");
      setEditingType(null);
      return;
    }

    setUpdatingConnector((prev) => new Set(prev).add(connectorId));
    try {
      await axios.put(`${API_URL}/admin/connectors/${connectorId}`, {
        type: newType,
      });
      await fetchStations();
      setEditingType(null);
    } catch (error) {
      console.error("Error updating connector type:", error);
      alert("Błąd podczas aktualizacji typu złącza");
    } finally {
      setUpdatingConnector((prev) => {
        const newSet = new Set(prev);
        newSet.delete(connectorId);
        return newSet;
      });
    }
  };

  const handleTypeCancel = () => {
    setEditingType(null);
  };

  const handlePowerEdit = (connectorId: string, currentPower: number) => {
    setEditingPower({ connectorId, value: currentPower.toString() });
  };

  const handlePowerSave = async (e: React.FormEvent, connectorId: string) => {
    e.preventDefault();
    if (!editingPower || editingPower.connectorId !== connectorId) return;

    const newPower = parseFloat(editingPower.value);
    if (isNaN(newPower) || newPower <= 0) {
      alert("Moc musi być liczbą większą od 0");
      setEditingPower(null);
      return;
    }

    setUpdatingConnector((prev) => new Set(prev).add(connectorId));
    try {
      await axios.put(`${API_URL}/admin/connectors/${connectorId}`, {
        powerKw: newPower,
      });
      await fetchStations();
      setEditingPower(null);
    } catch (error) {
      console.error("Error updating connector power:", error);
      alert("Błąd podczas aktualizacji mocy");
    } finally {
      setUpdatingConnector((prev) => {
        const newSet = new Set(prev);
        newSet.delete(connectorId);
        return newSet;
      });
    }
  };

  const handlePowerCancel = () => {
    setEditingPower(null);
  };

  const handleStationEdit = (station: Station) => {
    setEditingStation(station);
  };

  const handleStationSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStation) return;

    setIsUpdatingStation(true);
    try {
      await axios.put(`${API_URL}/admin/stations/${editingStation.id}`, {
        name: editingStation.name,
        address: editingStation.address,
        city: editingStation.city,
        latitude: editingStation.latitude ? parseFloat(editingStation.latitude.toString()) : null,
        longitude: editingStation.longitude ? parseFloat(editingStation.longitude.toString()) : null,
      });
      await fetchStations();
      setEditingStation(null);
    } catch (error) {
      console.error("Error updating station:", error);
      alert("Błąd podczas aktualizacji stacji");
    } finally {
      setIsUpdatingStation(false);
    }
  };

  const handleStationCancel = () => {
    setEditingStation(null);
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

  // Funkcja filtrująca stacje
  const filteredStations = stations.filter((station) => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase();
    const id = station.id.toLowerCase();
    const name = station.name.toLowerCase();
    const address = (station.address || "").toLowerCase();
    const city = (station.city || "").toLowerCase();
    
    return id.includes(query) || name.includes(query) || address.includes(query) || city.includes(query);
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900 mb-4">Stacje</h1>
        <div className="flex justify-center">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Szukaj stacji, adresu, miasta..."
            className="w-full max-w-lg border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-slate-500 focus:border-transparent"
          />
        </div>
      </div>
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
          ) : filteredStations.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <p>Brak stacji spełniających kryteria wyszukiwania.</p>
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
                {filteredStations.map((station) => {
                  const isExpanded = expandedStations.has(station.id);
                  
                  // Oblicz statystyki złączy dla stacji
                  const total = station.connectors.length;
                  // Liczba złączy ze statusem 'AVAILABLE' (bez aktywnej transakcji)
                  const available = station.connectors.filter(
                    c => c.status === 'AVAILABLE'
                  ).length;
                  const activeSessions = station.connectors.filter(
                    c => c.status === 'CHARGING' || c.status === 'OCCUPIED'
                  ).length;
                  
                  // Określ status stacji na podstawie logiki
                  let stationStatusLabel = '';
                  let stationStatusColor = '';
                  
                  if (available === 0 && total > 0) {
                    // Wszystkie złącza zajęte lub awaria
                    stationStatusLabel = `Zajęta (${available}/${total})`;
                    stationStatusColor = 'bg-red-100 text-red-800';
                  } else if (activeSessions > 0 || available < total) {
                    // Jest aktywna sesja LUB nie wszystkie złącza są wolne
                    stationStatusLabel = `W użyciu (${available}/${total})`;
                    stationStatusColor = 'bg-yellow-100 text-yellow-800';
                  } else if (available === total && total > 0) {
                    // Wszystkie złącza są wolne
                    stationStatusLabel = `Dostępna (${available}/${total})`;
                    stationStatusColor = 'bg-green-100 text-green-800';
                  } else {
                    // Domyślny status z bazy (z licznikiem jeśli są złącza)
                    const baseLabel = getStatusLabel(station.status);
                    stationStatusLabel = total > 0 ? `${baseLabel} (${available}/${total})` : baseLabel;
                    stationStatusColor = getStatusColor(station.status);
                  }
                  
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
                            className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${stationStatusColor}`}
                          >
                            {stationStatusLabel}
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
                              handleStationEdit(station);
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
                                              {editingType?.connectorId === connector.id ? (
                                                <form onSubmit={(e) => handleTypeSave(e, connector.id)} className="flex items-center gap-2">
                                                  <select
                                                    value={editingType.value}
                                                    onChange={(e) =>
                                                      setEditingType({
                                                        ...editingType,
                                                        value: e.target.value,
                                                      })
                                                    }
                                                    className="px-2 py-1 border border-slate-300 rounded text-sm"
                                                    autoFocus
                                                    onBlur={handleTypeCancel}
                                                  >
                                                    <option value="CCS">CCS</option>
                                                    <option value="Type2">Type2</option>
                                                    <option value="CHAdeMO">CHAdeMO</option>
                                                  </select>
                                                  <button
                                                    type="submit"
                                                    disabled={isUpdating}
                                                    className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                                                  >
                                                    ✓
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={handleTypeCancel}
                                                    className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                                                  >
                                                    ✕
                                                  </button>
                                                </form>
                                              ) : (
                                                <div className="flex items-center gap-2">
                                                  <span>{connector.type}</span>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleTypeEdit(connector.id, connector.type);
                                                    }}
                                                    disabled={isUpdating}
                                                    className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded disabled:opacity-50"
                                                    title="Edytuj typ złącza"
                                                  >
                                                    ✏️
                                                  </button>
                                                </div>
                                              )}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-700">
                                              {editingPower?.connectorId === connector.id ? (
                                                <form onSubmit={(e) => handlePowerSave(e, connector.id)} className="flex items-center gap-2">
                                                  <input
                                                    type="number"
                                                    step="1"
                                                    min="1"
                                                    value={editingPower.value}
                                                    onChange={(e) =>
                                                      setEditingPower({
                                                        ...editingPower,
                                                        value: e.target.value,
                                                      })
                                                    }
                                                    className="w-20 px-2 py-1 border border-slate-300 rounded text-sm"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                      if (e.key === "Escape") {
                                                        handlePowerCancel();
                                                      }
                                                    }}
                                                  />
                                                  <span className="text-xs text-slate-500">kW</span>
                                                  <button
                                                    type="submit"
                                                    disabled={isUpdating}
                                                    className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                                                  >
                                                    ✓
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={handlePowerCancel}
                                                    className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                                                  >
                                                    ✕
                                                  </button>
                                                </form>
                                              ) : (
                                                <div className="flex items-center gap-2">
                                                  <span>{connector.powerKw} kW</span>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handlePowerEdit(connector.id, connector.powerKw);
                                                    }}
                                                    disabled={isUpdating}
                                                    className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded disabled:opacity-50"
                                                    title="Edytuj moc"
                                                  >
                                                    ✏️
                                                  </button>
                                                </div>
                                              )}
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
      
      {/* Modal edycji stacji */}
      {editingStation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-900">Edytuj stację</h2>
              <button
                onClick={handleStationCancel}
                className="text-slate-500 hover:text-slate-700 text-2xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleStationSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nazwa
                </label>
                <input
                  type="text"
                  value={editingStation.name}
                  onChange={(e) =>
                    setEditingStation({ ...editingStation, name: e.target.value })
                  }
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Adres
                </label>
                <input
                  type="text"
                  value={editingStation.address || ""}
                  onChange={(e) =>
                    setEditingStation({ ...editingStation, address: e.target.value || null })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Miasto
                </label>
                <input
                  type="text"
                  value={editingStation.city || ""}
                  onChange={(e) =>
                    setEditingStation({ ...editingStation, city: e.target.value || null })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Latitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={editingStation.latitude || ""}
                  onChange={(e) =>
                    setEditingStation({
                      ...editingStation,
                      latitude: e.target.value ? parseFloat(e.target.value) : null,
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Longitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={editingStation.longitude || ""}
                  onChange={(e) =>
                    setEditingStation({
                      ...editingStation,
                      longitude: e.target.value ? parseFloat(e.target.value) : null,
                    })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={handleStationCancel}
                  disabled={isUpdatingStation}
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingStation}
                  className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  {isUpdatingStation ? "Zapisywanie..." : "Zapisz"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
