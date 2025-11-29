"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface Transaction {
  id: string;
  stripePaymentId: string;
  stationId: string;
  connectorId: string | null;
  station: {
    id: string;
    name: string;
    connectorType: string;
  };
  connector: {
    id: string;
    type: string;
    powerKw: number;
  } | null;
  amount: number;
  finalCost: number | null;
  energyKwh: number;
  startTime: string;
  endTime: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function StatusBadge({ status }: { status: string }) {
  const statusUpper = status.toUpperCase();
  
  if (statusUpper === "COMPLETED") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        Zakończona
      </span>
    );
  } else if (statusUpper === "CHARGING" || statusUpper === "ACTIVE" || statusUpper === "PENDING") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
        W Trakcie
      </span>
    );
  } else if (statusUpper === "FAULTED" || statusUpper === "FAILED") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
        Błąd
      </span>
    );
  }
  
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
      {status}
    </span>
  );
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      const response = await axios.get(`${API_URL}/admin/transactions`);
      setTransactions(response.data);
    } catch (error) {
      console.error("Error fetching transactions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDateForPDF = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const formatDateTimeForPDF = (dateString: string) => {
    const date = new Date(dateString);
    const dateStr = date.toLocaleDateString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const timeStr = date.toLocaleTimeString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${dateStr} ${timeStr}`;
  };

  // Funkcja pomocnicza do usuwania polskich znaków
  const removePolishChars = (str: string) => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/Ł/g, "L").replace(/ł/g, "l");
  };

  const handleOpenModal = () => {
    // Ustaw domyślne daty (ostatnie 30 dni)
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    setReportStartDate(thirtyDaysAgo.toISOString().split("T")[0]);
    setReportEndDate(today.toISOString().split("T")[0]);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setReportStartDate("");
    setReportEndDate("");
  };

  const generatePDF = async () => {
    if (!reportStartDate || !reportEndDate) {
      alert("Proszę wybrać zakres dat");
      return;
    }

    setIsGeneratingPDF(true);
    try {
      // Pobierz transakcje z wybranego zakresu dat
      const startDate = new Date(reportStartDate);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(reportEndDate);
      endDate.setHours(23, 59, 59, 999);

      // Filtruj transakcje z obecnych danych lub pobierz z API
      const filteredTransactions = transactions.filter((tx) => {
        const txDate = new Date(tx.createdAt);
        return txDate >= startDate && txDate <= endDate;
      });

      // Jeśli nie ma transakcji w obecnych danych, spróbuj pobrać z API
      let transactionsToExport = filteredTransactions;
      if (filteredTransactions.length === 0) {
        try {
          const response = await axios.get(`${API_URL}/admin/transactions`);
          const allTransactions = response.data;
          transactionsToExport = allTransactions.filter((tx: Transaction) => {
            const txDate = new Date(tx.createdAt);
            return txDate >= startDate && txDate <= endDate;
          });
        } catch (error) {
          console.error("Error fetching transactions for PDF:", error);
        }
      }

      // Generuj PDF w orientacji poziomej (landscape)
      const doc = new jsPDF({ orientation: 'landscape' });
      
      // Nagłówek
      doc.setFontSize(18);
      doc.text(removePolishChars("Raport Transakcji PlugBox"), 14, 20);
      
      // Zakres dat
      doc.setFontSize(11);
      doc.text(removePolishChars(`Zakres: ${formatDateForPDF(reportStartDate)} - ${formatDateForPDF(reportEndDate)}`), 14, 30);
      doc.text(removePolishChars(`Liczba transakcji: ${transactionsToExport.length}`), 14, 37);
      
      // Przygotuj dane do tabeli
      const tableData = transactionsToExport.map((tx) => {
        const displayCost = tx.finalCost !== null && tx.finalCost !== undefined
          ? tx.finalCost
          : tx.amount;
        
        const connectorInfo = tx.connector
          ? `${tx.connector.type} (${tx.connector.powerKw} kW)`
          : tx.connectorId
          ? `Złącze #${tx.connectorId}`
          : "-";
        
        const statusText = tx.status.toUpperCase() === "COMPLETED"
          ? "Zakończona"
          : tx.status.toUpperCase() === "CHARGING" || tx.status.toUpperCase() === "ACTIVE" || tx.status.toUpperCase() === "PENDING"
          ? "W Trakcie"
          : tx.status.toUpperCase() === "FAULTED" || tx.status.toUpperCase() === "FAILED"
          ? "Błąd"
          : tx.status;
        
        return [
          tx.stripePaymentId, // ID (Stripe) - pełne, bez ucinania
          removePolishChars(tx.station.name), // Stacja
          removePolishChars(connectorInfo), // Złącze
          `${displayCost.toFixed(2)} PLN`, // Kwota
          `${tx.energyKwh.toFixed(2)} kWh`, // Energia
          removePolishChars(statusText), // Status
          formatDateTimeForPDF(tx.createdAt), // Data z czasem
        ];
      });

      // Dodaj tabelę
      autoTable(doc, {
        head: [[removePolishChars("ID (Stripe)"), removePolishChars("Stacja"), removePolishChars("Złącze"), removePolishChars("Kwota"), removePolishChars("Energia (kWh)"), removePolishChars("Status"), removePolishChars("Data")]],
        body: tableData,
        startY: 45,
        styles: {
          fontSize: 8,
          cellPadding: 2,
        },
        headStyles: {
          fillColor: [241, 245, 249], // slate-100
          textColor: [51, 65, 85], // slate-700
          fontStyle: "bold",
          fontSize: 8,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252], // slate-50
        },
        columnStyles: {
          0: { cellWidth: 45, fontSize: 7 }, // ID (Stripe) - pełne ID z mniejszą czcionką
          1: { cellWidth: 40 }, // Stacja
          2: { cellWidth: 40 }, // Złącze
          3: { cellWidth: 30 }, // Kwota
          4: { cellWidth: 30 }, // Energia
          5: { cellWidth: 30 }, // Status
          6: { cellWidth: 50 }, // Data - więcej miejsca dla daty z czasem
        },
      });

      // Zapisz PDF
      const fileName = `transakcje_${reportStartDate}_${reportEndDate}.pdf`;
      doc.save(fileName);
      
      handleCloseModal();
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Wystąpił błąd podczas generowania PDF");
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // Funkcja filtrująca transakcje
  const filteredTransactions = transactions.filter((transaction) => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase();
    const stripeId = transaction.stripePaymentId.toLowerCase();
    const stationName = transaction.station.name.toLowerCase();
    const connectorType = transaction.connector?.type.toLowerCase() || "";
    const connectorInfo = transaction.connector 
      ? `${transaction.connector.type} (${transaction.connector.powerKw} kW)`.toLowerCase()
      : transaction.connectorId 
      ? `zlacze #${transaction.connectorId}`.toLowerCase()
      : "";
    
    // Mapowanie statusów do polskich nazw
    const statusMap: Record<string, string> = {
      "COMPLETED": "zakonczona",
      "CHARGING": "w trakcie",
      "ACTIVE": "w trakcie",
      "PENDING": "w trakcie",
      "FAULTED": "blad",
      "FAILED": "blad",
    };
    const statusText = statusMap[transaction.status.toUpperCase()] || transaction.status.toLowerCase();
    
    return (
      stripeId.includes(query) ||
      stationName.includes(query) ||
      connectorType.includes(query) ||
      connectorInfo.includes(query) ||
      statusText.includes(query)
    );
  });

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold text-slate-900">Transakcje</h1>
          <button
            onClick={handleOpenModal}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors flex items-center gap-2"
          >
            📄 Wygeneruj Raport
          </button>
        </div>
        <div className="flex justify-center">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Szukaj ID, stacji, statusu..."
            className="w-full max-w-lg border border-slate-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-slate-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Eksport Transakcji</h2>
            
            <div className="space-y-4 mb-6">
              <div>
                <label htmlFor="reportStartDate" className="block text-sm font-medium text-slate-700 mb-2">
                  Od dnia:
                </label>
                <input
                  type="date"
                  id="reportStartDate"
                  value={reportStartDate}
                  onChange={(e) => setReportStartDate(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label htmlFor="reportEndDate" className="block text-sm font-medium text-slate-700 mb-2">
                  Do dnia:
                </label>
                <input
                  type="date"
                  id="reportEndDate"
                  value={reportEndDate}
                  onChange={(e) => setReportEndDate(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCloseModal}
                disabled={isGeneratingPDF}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Anuluj
              </button>
              <button
                onClick={generatePDF}
                disabled={isGeneratingPDF || !reportStartDate || !reportEndDate}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isGeneratingPDF ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Generowanie...
                  </>
                ) : (
                  "Pobierz PDF"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-12 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600"></div>
          <p className="mt-4 text-slate-600">Ładowanie transakcji...</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          {transactions.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <p>Brak transakcji w bazie danych.</p>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <p>Brak transakcji spełniających kryteria wyszukiwania.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    ID (Stripe)
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Stacja
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Złącze
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Kwota
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    kWh
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Data
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {filteredTransactions.map((transaction) => {
                  // Użyj finalCost jeśli dostępne, w przeciwnym razie amount
                  const displayCost = transaction.finalCost !== null && transaction.finalCost !== undefined
                    ? transaction.finalCost
                    : transaction.amount;
                  
                  return (
                    <tr key={transaction.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                        {transaction.stripePaymentId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        {transaction.station.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        {transaction.connector ? (
                          <span>
                            {transaction.connector.type} ({transaction.connector.powerKw} kW)
                          </span>
                        ) : transaction.connectorId ? (
                          <span>Złącze #{transaction.connectorId}</span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        {displayCost.toFixed(2)} zł
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        {transaction.energyKwh.toFixed(2)} kWh
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        <StatusBadge status={transaction.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                        {formatDate(transaction.createdAt)}
                      </td>
                    </tr>
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

