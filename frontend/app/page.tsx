"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import axios from "axios";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Zap, Plug, BatteryCharging, Info, Wallet, Clock, CheckCircle2, AlertCircle, ArrowLeft, CreditCard } from "lucide-react";

// --- KONFIGURACJA ---
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const STRIPE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = loadStripe(STRIPE_KEY);

type ViewState = "idle" | "payment" | "charging" | "summary";

// --- HOOK DO OPÓŹNIENIA (Debounce) ---
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

// --- KOMPONENT PŁATNOŚCI STRIPE ---
const CheckoutForm = ({ amount, onSuccess, onCancel }: { amount: number, onSuccess: () => void, onCancel: () => void }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href,
      },
      redirect: "if_required",
    });

    if (result.error) {
      setError(result.error.message || "Wystąpił błąd płatności");
      setProcessing(false);
    } else if (result.paymentIntent && result.paymentIntent.status === "succeeded") {
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 mt-4">
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm min-h-[200px]">
        {/* To jest miejsce, gdzie Stripe wstrzykuje swój formularz */}
        <PaymentElement id="payment-element" options={{ layout: "tabs" }} />
      </div>
      
      {error && (
        <div className="p-3 bg-rose-50 text-rose-600 text-sm rounded-lg flex items-center gap-2 border border-rose-100">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* PRZYCISKI AKCJI */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={processing}
          className="w-full py-4 px-4 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors"
        >
          Anuluj
        </button>
        <button
          type="submit"
          disabled={!stripe || processing}
          className="w-full py-4 px-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 flex justify-center items-center gap-2"
        >
          {processing ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Przetwarzanie
            </span>
          ) : (
            <>
              <Zap size={20} fill="currentColor" />
              Zapłać {amount} zł
            </>
          )}
        </button>
      </div>
    </form>
  );
};

// --- GŁÓWNA ZAWARTOŚĆ ---
function HomeContent() {
  const searchParams = useSearchParams();
  const stationId = searchParams.get("station");
  
  // Stany
  const [isLoading, setIsLoading] = useState(true);
  const [viewState, setViewState] = useState<ViewState>("idle");
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(50);
  const [clientSecret, setClientSecret] = useState("");
  const [isInitializingPayment, setIsInitializingPayment] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  
  const debouncedAmount = useDebounce(amount, 800);
  
  const [energyKwh, setEnergyKwh] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [lastSessionCost, setLastSessionCost] = useState(0);
  const [refundAmount, setRefundAmount] = useState(0);
  const [invoiceEmail, setInvoiceEmail] = useState<string | null>(null);
  const [customerEmail, setCustomerEmail] = useState("");
  const [stationAddress, setStationAddress] = useState<string | null>(null);
  const [stationCity, setStationCity] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<Array<{
    id: string;
    name: string;
    type: string;
    power: string;
    status: string;
    icon: typeof Plug | typeof Zap | typeof BatteryCharging;
  }>>([]);

  const PRICE_PER_KWH = 2.50;

  // Mapowanie ikon dla złączy (na podstawie typu)
  const getConnectorIcon = (type: string): typeof Plug | typeof Zap | typeof BatteryCharging => {
    if (type.includes('CCS')) return Zap;
    if (type.includes('CHAdeMO')) return BatteryCharging;
    return Plug; // Type 2 i domyślnie
  };

  // Mapowanie statusu na tekst wyświetlany
  const getStatusText = (status: string): string => {
    switch (status) {
      case 'CHARGING':
        return 'Zajęte';
      case 'OCCUPIED':
        return 'Zajęte';
      case 'FAULTED':
        return 'Awaria';
      case 'AVAILABLE':
        return 'Wolne';
      default:
        return status;
    }
  };

  const selectedConnectorData = connectors.find(c => c.id === connectorId);

  // --- LOGIKA ---

  // Pobierz dane stacji (address, city, connectors) przy mount
  useEffect(() => {
    if (stationId) {
      const fetchStationData = async () => {
        try {
          const response = await axios.get(`${API_URL}/station/${stationId}`);
          if (response.data.success && response.data.station) {
            setStationAddress(response.data.station.address || null);
            setStationCity(response.data.station.city || null);
            
            // Pobierz złącza z backendu i dodaj ikony
            if (response.data.station.connectors && Array.isArray(response.data.station.connectors)) {
              const connectorsWithIcons = response.data.station.connectors.map((connector: {
                id: string;
                name: string;
                type: string;
                power: string;
                status: string;
              }) => ({
                ...connector,
                icon: getConnectorIcon(connector.type),
              }));
              setConnectors(connectorsWithIcons);
            } else {
              // Fallback: jeśli backend nie zwraca złączy, użyj domyślnych
              const defaultConnectors = [
                { id: '1', name: 'Złącze A', type: 'Type 2', power: '22 kW', status: 'AVAILABLE', icon: Plug },
                { id: '2', name: 'Złącze B', type: 'CCS', power: '50 kW', status: 'AVAILABLE', icon: Zap },
                { id: '3', name: 'Złącze C', type: 'CHAdeMO', power: '50 kW', status: 'AVAILABLE', icon: BatteryCharging },
              ];
              setConnectors(defaultConnectors);
            }
          }
        } catch (err) {
          console.error("Błąd pobierania danych stacji:", err);
        }
      };
      fetchStationData();
    }
  }, [stationId]);

  // Odzyskiwanie sesji przy mount - sprawdź czy jest aktywna sesja
  useEffect(() => {
    if (stationId) {
      const checkActiveSession = async () => {
        setIsLoading(true);
        try {
          console.log(`[Session Recovery] Sprawdzam aktywną sesję dla stacji: ${stationId}`);
          const response = await axios.get(`${API_URL}/stations/${stationId}/active-session`);
          
          console.log('Session Check:', response.data);
          
          if (response.data.success && response.data.data) {
            const sessionData = response.data.data;
            console.log(`[Session Recovery] Znaleziono aktywną sesję:`, sessionData);
            
            // Ustaw viewState na charging
            setViewState("charging");
            
            // Zaktualizuj startTime na podstawie danych z backendu
            if (sessionData.startTime) {
              setSessionStartTime(new Date(sessionData.startTime));
            }
            
            // Zaktualizuj amount na podstawie wpłaconej kwoty
            if (sessionData.amount) {
              setAmount(sessionData.amount);
            }
            
            // Ustaw connectorId (domyślnie 1, zgodnie z logiką OCPP)
            if (sessionData.connectorId) {
              setConnectorId(sessionData.connectorId.toString());
            } else {
              setConnectorId("1");
            }
            
            console.log(`[Session Recovery] Sesja odzyskana - viewState: charging, amount: ${sessionData.amount}, startTime: ${sessionData.startTime}`);
          } else {
            console.log(`[Session Recovery] Brak aktywnej sesji dla stacji: ${stationId}`);
          }
        } catch (err: any) {
          // 404 oznacza brak aktywnej sesji - to jest OK
          if (err.response?.status === 404) {
            console.log(`[Session Recovery] Brak aktywnej sesji (404)`);
          } else {
            console.error("[Session Recovery] Błąd sprawdzania sesji:", err);
          }
        } finally {
          setIsLoading(false);
        }
      };
      
      checkActiveSession();
    } else {
      // Jeśli nie ma stationId, od razu ustaw isLoading na false
      setIsLoading(false);
    }
  }, [stationId]);

  // Socket.io do nasłuchiwania na aktualizacje energii z OCPP
  useEffect(() => {
    if (viewState === "charging" && stationId) {
      const newSocket = io(API_URL, { transports: ["websocket", "polling"] });
      
      newSocket.on("connect", () => {
        console.log("[Socket.IO] Połączono z serwerem");
      });
      
      newSocket.on("energy_update", (data: any) => {
        console.log("[Socket.IO] Otrzymano energy_update:", data);
        if (data.stationId === stationId && data.energy !== null) {
          const energyKwh = data.energy / 1000; // Konwersja z Wh na kWh
          setEnergyKwh(energyKwh);
          console.log("[Socket.IO] Zaktualizowano energię:", energyKwh, "kWh");
        }
      });
      
      newSocket.on("disconnect", () => {
        console.log("[Socket.IO] Rozłączono z serwerem");
      });
      
      setSocket(newSocket);
      return () => {
        newSocket.disconnect();
        setSocket(null);
      };
    }
  }, [viewState, stationId]);

  // Polling energii z bazy danych jako fallback (co 2 sekundy)
  useEffect(() => {
    if (viewState === "charging" && stationId) {
      const fetchEnergy = async () => {
        try {
          const response = await axios.get(`${API_URL}/energy/${stationId}`);
          if (response.data.success && response.data.energyKwh !== undefined) {
            setEnergyKwh(response.data.energyKwh);
          }
        } catch (err) {
          console.error("Błąd pobierania energii:", err);
        }
      };

      // Pobierz od razu
      fetchEnergy();
      
      // Następnie co 2 sekundy
      const interval = setInterval(fetchEnergy, 2000);
      
      return () => clearInterval(interval);
    }
  }, [viewState, stationId]);

  useEffect(() => {
    if (viewState === "charging" && sessionStartTime) {
      const interval = setInterval(() => {
        const now = new Date();
        setSessionDuration(Math.floor((now.getTime() - sessionStartTime.getTime()) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [viewState, sessionStartTime]);

  const initializePayment = async () => {
    if (!stationId || debouncedAmount <= 0) return;
    
    setIsInitializingPayment(true);
    setShowPaymentForm(false);
    try {
      setClientSecret(""); 
      const res = await axios.post(`${API_URL}/create-payment-intent`, { 
        amount: debouncedAmount * 100,
        stationId: stationId 
      });
      setClientSecret(res.data.clientSecret);
      setShowPaymentForm(true);
    } catch (err) {
      console.error("Błąd płatności:", err);
      alert("Nie udało się zainicjować płatności. Sprawdź konsolę.");
    } finally {
      setIsInitializingPayment(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleSelectConnector = (id: string) => {
    setConnectorId(id);
    setViewState("payment");
    setShowPaymentForm(false);
    setClientSecret("");
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = Number(e.target.value);
    if (val > 500) val = 500;
    if (val < 0) val = 0;
    setAmount(val);
  };

  const handlePaymentSuccess = async () => {
    if (!stationId) {
      alert("Brak ID stacji. Sprawdź URL.");
      return;
    }

    try {
      const response = await axios.get(`${API_URL}/start/${stationId}`);
      
      if (response.data.success) {
        setViewState("charging");
        setSessionStartTime(new Date());
        setEnergyKwh(0);
      } else {
        alert(`Błąd: ${response.data.message || "Nie udało się rozpocząć ładowania"}`);
      }
    } catch (err: any) {
      console.error("Błąd startu stacji:", err);
      const errorMessage = err.response?.data?.message || err.message || "Nie udało się rozpocząć ładowania";
      alert(`Błąd startu stacji: ${errorMessage}`);
    }
  };

  const handleStopCharging = async () => {
    if (isStopping) return;
    setIsStopping(true);
    try {
      const params = customerEmail ? `?email=${encodeURIComponent(customerEmail)}` : '';
      const response = await axios.get(`${API_URL}/stop/${stationId}${params}`);
      
      if (response.data.success) {
        // Użyj danych z backendu (zawierają rzeczywiste wartości z bazy danych)
        const finalCost = response.data.finalCost || (energyKwh * PRICE_PER_KWH);
        const refundAmount = response.data.refundAmount || Math.max(0, amount - finalCost);
        
        setLastSessionCost(finalCost);
        setRefundAmount(refundAmount);
        
        if (response.data.invoiceSent && response.data.email) {
          setInvoiceEmail(response.data.email);
        }
        
        if (socket) socket.disconnect();
        setViewState("summary");
      } else {
        alert(`Błąd: ${response.data.message || "Nie udało się zakończyć ładowania"}`);
      }
    } catch (err: any) {
      console.error("Błąd zatrzymywania:", err);
      const errorMessage = err.response?.data?.message || err.message || "Nie udało się zakończyć ładowania";
      alert(`Błąd zatrzymywania: ${errorMessage}`);
    } finally {
      setIsStopping(false);
    }
  };

  // --- RENDEROWANIE WIDOKÓW ---

  // Ekran ładowania podczas sprawdzania sesji
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4 font-sans">
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
            <Zap size={40} className="text-emerald-600 animate-pulse" fill="currentColor" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-slate-900">Łączenie ze stacją...</h2>
            <p className="text-sm text-slate-500 font-medium">Sprawdzanie aktywnej sesji</p>
          </div>
        </div>
      </div>
    );
  }

  // 1. WYBÓR ZŁĄCZA
  if (!stationId || viewState === "idle") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100">
          <div className="bg-white p-8 pb-4 text-center border-b border-slate-50">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
              <Zap size={32} fill="currentColor" />
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Stacja {stationId || "Demo"}</h1>
            {(stationAddress || stationCity) && (
              <p className="text-slate-500 font-medium text-sm mb-2">
                {stationAddress && <span>{stationAddress}</span>}
                {stationAddress && stationCity && <span>, </span>}
                {stationCity && <span>{stationCity}</span>}
              </p>
            )}
            <div className="flex items-center justify-center gap-2 mt-2">
              <button className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 transition-colors">
                <span>📍</span>
                <span>Wybierz inny punkt</span>
              </button>
            </div>
            <p className="text-slate-500 font-medium mt-3">Wybierz punkt ładowania</p>
          </div>

          <div className="p-6 space-y-4">
            {connectors.map((c) => {
              const Icon = c.icon;
              // Złącze jest nieaktywne jeśli status nie jest 'AVAILABLE'
              const isUnavailable = c.status !== 'AVAILABLE';
              const statusText = getStatusText(c.status);
              
              return (
                <button
                  key={c.id}
                  disabled={isUnavailable}
                  onClick={() => !isUnavailable && handleSelectConnector(c.id)}
                  className={`w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all duration-200 group text-left
                    ${isUnavailable 
                      ? 'border-slate-50 bg-slate-50 opacity-50 cursor-not-allowed grayscale' 
                      : 'border-slate-100 bg-white hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10 active:scale-[0.98]'
                    }
                  `}
                >
                  <div className="flex items-center gap-5">
                    <div className={`p-3.5 rounded-xl ${isUnavailable ? 'bg-slate-200 text-slate-400' : 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100'}`}>
                      <Icon size={28} strokeWidth={2} />
                    </div>
                    <div>
                      <p className={`font-bold text-lg ${isUnavailable ? 'text-slate-500' : 'text-slate-800 group-hover:text-emerald-900'}`}>{c.name}</p>
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                        <span>{c.type}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <span>{c.power}</span>
                      </div>
                      {isUnavailable && (
                        <p className="text-xs text-slate-400 font-medium mt-1">{statusText}</p>
                      )}
                    </div>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                    isUnavailable 
                      ? 'bg-slate-200 text-slate-500' 
                      : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {statusText}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // 2. DOKONAJ PRZEDPŁATY
  if (viewState === "payment") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100">
          
          <div className="p-6 border-b border-slate-50 flex items-center">
            <button onClick={() => setViewState('idle')} className="p-2 -ml-2 hover:bg-slate-50 rounded-full text-slate-400 transition-colors">
              <ArrowLeft size={24} />
            </button>
            <span className="font-bold text-lg text-slate-800 ml-2">Dokonaj przedpłaty</span>
          </div>

          <div className="p-8 space-y-8">
            <div className="flex items-center gap-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
              <div className="p-3 bg-white rounded-xl shadow-sm text-emerald-600">
                {selectedConnectorData?.icon && <selectedConnectorData.icon size={24} />}
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide mb-0.5">WYBRANO</p>
                <p className="font-bold text-slate-900">{selectedConnectorData?.name}</p>
                <p className="text-xs text-slate-500 font-medium">{selectedConnectorData?.power} • {selectedConnectorData?.type}</p>
              </div>
            </div>

            <div className="text-center py-4">
              <div className="relative inline-flex items-center justify-center">
                <input
                  type="number"
                  value={amount}
                  onChange={handleAmountChange}
                  className="text-7xl font-black text-slate-900 text-center w-48 bg-transparent border-b-2 border-slate-200 focus:border-emerald-500 focus:outline-none p-0 pb-2 transition-colors" 
                />
                <span className="text-2xl font-bold text-slate-400 ml-2 mt-4">PLN</span>
              </div>
              <p className="text-slate-400 font-medium text-sm mt-4">Wpisz kwotę lub użyj suwaka</p>
            </div>

            <div className="px-2">
              <input
                type="range"
                min="20"
                max="500"
                step="5"
                value={amount}
                onChange={handleAmountChange}
                className="w-full h-4 bg-slate-100 rounded-full appearance-none cursor-pointer accent-emerald-600 hover:accent-emerald-500 transition-all"
              />
              <div className="flex justify-between text-xs font-bold text-slate-400 mt-3 px-1">
                <span>20 PLN</span>
                <span>500 PLN</span>
              </div>
            </div>

            <div className="space-y-4 pt-2">
              <div className="bg-blue-50/50 p-4 rounded-xl flex gap-3 items-start border border-blue-100">
                <Info className="text-blue-500 shrink-0 mt-0.5" size={18} />
                <p className="text-xs text-blue-700 font-medium leading-relaxed">
                  Niewykorzystane środki zostaną automatycznie zwrócone na Twoją kartę natychmiast po zakończeniu ładowania.
                </p>
              </div>

              {/* PRZYCISK DO PŁATNOŚCI */}
              {!showPaymentForm && !isInitializingPayment && (
                <button
                  onClick={initializePayment}
                  disabled={amount <= 0 || amount > 500}
                  className="w-full py-5 px-6 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  <CreditCard size={24} />
                  Przejdź do płatności {amount} zł
                </button>
              )}

              {/* KONTENER PŁATNOŚCI */}
              {showPaymentForm && (
                <div className="min-h-[100px] w-full">
                  {isInitializingPayment ? (
                    <div className="flex flex-col items-center justify-center py-8 space-y-4">
                      <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-emerald-500 rounded-full"></div>
                      <p className="text-sm text-slate-400 font-medium">Łączenie z bankiem...</p>
                    </div>
                  ) : clientSecret ? (
                    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#059669' } } }}>
                      <CheckoutForm 
                        amount={debouncedAmount} 
                        onSuccess={handlePaymentSuccess} 
                        onCancel={() => {
                          setShowPaymentForm(false);
                          setClientSecret("");
                        }} 
                      />
                    </Elements>
                  ) : (
                    <div className="p-4 bg-rose-50 text-rose-600 text-sm rounded-xl border border-rose-100 text-center">
                      Nie udało się połączyć z serwerem płatności. Sprawdź czy backend działa.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. ŁADOWANIE W CZASIE RZECZYWISTYM
  if (viewState === "charging") {
    const currentCost = energyKwh * PRICE_PER_KWH;
    const percentageUsed = amount > 0 ? (currentCost / amount) * 100 : 0;
    const remainingAmount = Math.max(0, amount - currentCost);

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 overflow-hidden border border-slate-100">
          
          {/* Header */}
          <div className="p-6 border-b border-slate-50 bg-gradient-to-r from-emerald-50 to-emerald-100/50">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse shadow-lg shadow-emerald-500/50"></div>
                  <span className="font-bold text-lg text-slate-900">Ładowanie aktywne</span>
                </div>
                {selectedConnectorData && (
                  <div className="px-3 py-1.5 bg-white rounded-full border border-emerald-200">
                    <span className="text-xs font-bold text-emerald-700">{selectedConnectorData.power}</span>
                  </div>
                )}
              </div>
              {(stationAddress || stationCity) && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-600 font-medium">
                    {stationAddress && <span>{stationAddress}</span>}
                    {stationAddress && stationCity && <span>, </span>}
                    {stationCity && <span>{stationCity}</span>}
                  </p>
                  <button className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 transition-colors">
                    <span>📍</span>
                    <span>Wybierz inny punkt</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="p-8 space-y-6">
            {/* Informacja o wybranej ładowarce */}
            {selectedConnectorData && (
              <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="p-3 bg-emerald-100 rounded-xl text-emerald-600">
                  {selectedConnectorData.icon && <selectedConnectorData.icon size={24} />}
                </div>
                <div className="flex-1">
                  <p className="font-bold text-slate-900">{selectedConnectorData.name}</p>
                  <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                    <span>{selectedConnectorData.type}</span>
                    <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                    <span>{selectedConnectorData.power}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Główna metryka - Pobrana energia */}
            <div className="text-center py-6">
              <h1 className="text-6xl font-black tracking-tight mb-2 text-slate-900">{energyKwh.toFixed(2)}</h1>
              <p className="text-slate-500 font-medium text-lg">Pobrana energia (kWh)</p>
            </div>

            {/* Statystyki */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <Wallet className="text-emerald-600 mb-3 mx-auto" size={24} />
                <p className="text-3xl font-bold mb-1 text-slate-900">{currentCost.toFixed(2)} <span className="text-sm text-slate-500">zł</span></p>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Koszt</p>
              </div>
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <Clock className="text-blue-600 mb-3 mx-auto" size={24} />
                <p className="text-3xl font-bold mb-1 font-mono text-slate-900">{formatTime(sessionDuration)}</p>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Czas trwania</p>
              </div>
            </div>

            {/* Pasek wykorzystania środków */}
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-3">
              <div className="flex justify-between text-sm font-medium text-slate-700">
                <span>Wykorzystano środków</span>
                <span className="font-bold">{currentCost.toFixed(2)} / {amount.toFixed(2)} zł</span>
              </div>
              <div className="h-4 bg-slate-200 rounded-full overflow-hidden relative">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-1000 ease-linear"
                  style={{ width: `${Math.min(percentageUsed, 100)}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Pozostało: {remainingAmount.toFixed(2)} zł</span>
                <span>{percentageUsed.toFixed(1)}% wykorzystano</span>
              </div>
            </div>

            {/* Email do faktury */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <label className="block text-xs text-slate-600 font-medium uppercase tracking-wide mb-2">
                Email do faktury (opcjonalnie)
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="twoj@email.pl"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
              />
            </div>

            {/* Przycisk zakończenia */}
            <button
              onClick={handleStopCharging}
              disabled={isStopping}
              className="w-full py-5 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl font-bold text-lg shadow-lg shadow-rose-600/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {isStopping ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Zatrzymywanie...
                </span>
              ) : (
                <>
                  <div className="w-3 h-3 bg-white rounded-sm"></div>
                  Zakończ ładowanie
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (viewState === "summary") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 p-8 text-center space-y-8 border border-slate-100 animate-in zoom-in-95 duration-300">
          <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <CheckCircle2 className="text-emerald-600" size={48} strokeWidth={3} />
          </div>
          
          <div>
            <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Gotowe!</h2>
            <p className="text-slate-500 font-medium">Ładowanie zakończone pomyślnie</p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-6 space-y-4 border border-slate-100">
            <div className="flex justify-between border-b border-slate-200 pb-4">
              <span className="text-slate-500 font-medium">Pobrana energia</span>
              <span className="font-bold text-slate-900 text-lg">{energyKwh.toFixed(2)} kWh</span>
            </div>
            <div className="flex justify-between border-b border-slate-200 pb-4">
              <span className="text-slate-500 font-medium">Czas trwania</span>
              <span className="font-bold text-slate-900 text-lg">{formatTime(sessionDuration)}</span>
            </div>
            <div className="flex justify-between pt-2">
              <span className="text-slate-500 font-medium">Koszt całkowity</span>
              <span className="font-bold text-slate-900 text-xl">{lastSessionCost.toFixed(2)} zł</span>
            </div>
          </div>

          <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-100/50 shadow-sm">
            <p className="text-emerald-900 font-bold text-xl mb-1">Zwrot na kartę: {refundAmount.toFixed(2)} zł</p>
            <p className="text-xs text-emerald-700 font-medium opacity-80">Środki wrócą na Twoje konto w ciągu kilku chwil.</p>
          </div>

          {invoiceEmail && (
            <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100/50 shadow-sm">
              <div className="flex items-start gap-3">
                <Info className="text-blue-600 shrink-0 mt-0.5" size={20} />
                <div className="text-left">
                  <p className="text-blue-900 font-bold text-sm mb-1">Faktura wysłana</p>
                  <p className="text-xs text-blue-700 font-medium opacity-80">
                    Faktura została wysłana na adres: <span className="font-bold">{invoiceEmail}</span>
                  </p>
                </div>
              </div>
            </div>
          )}

          <button 
            onClick={() => {
              setViewState("idle");
              setAmount(50);
              setConnectorId(null);
              setInvoiceEmail(null);
              setCustomerEmail("");
            }}
            className="w-full py-4 text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-xl font-bold transition-all"
          >
            Wróć do ekranu głównego
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default function Home() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Ładowanie aplikacji...</div>}>
      <HomeContent />
    </Suspense>
  );
}