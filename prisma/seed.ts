import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Rozpoczynam seedowanie bazy danych...')

  // 1. Wyczyść stare dane (opcjonalne, ale zalecane przy testach)
  // Uwaga: Kolejność ważna ze względu na klucze obce!
  await prisma.transaction.deleteMany({})
  await prisma.connector.deleteMany({})
  await prisma.station.deleteMany({})

  console.log('🧹 Stare dane usunięte.')

  // 2. Definicja stacji do dodania
  const stationsData = [
    {
      id: 'CP_001',
      name: 'Galeria Mokotów (HUB)',
      address: 'Wołoska 12',
      city: 'Warszawa',
      latitude: 52.1800,
      longitude: 21.0000,
      connectors: [
        { id: '1', type: 'CCS', powerKw: 150, pricePerKwh: 2.90, status: 'AVAILABLE' },
        { id: '2', type: 'CCS', powerKw: 150, pricePerKwh: 2.90, status: 'CHARGING' }, // Test zajętości
        { id: '3', type: 'Type2', powerKw: 22, pricePerKwh: 1.50, status: 'AVAILABLE' },
      ]
    },
    {
      id: 'CP_002',
      name: 'Powiśle Parking',
      address: 'Dobra 56',
      city: 'Warszawa',
      latitude: 52.2430,
      longitude: 21.0280,
      connectors: [
        { id: '4', type: 'Type2', powerKw: 11, pricePerKwh: 1.40, status: 'AVAILABLE' },
        { id: '5', type: 'Type2', powerKw: 11, pricePerKwh: 1.40, status: 'AVAILABLE' },
      ]
    },
    {
      id: 'CP_003',
      name: 'Wola Tower',
      address: 'Górczewska 124',
      city: 'Warszawa',
      latitude: 52.2390,
      longitude: 20.9340,
      connectors: [
        { id: '6', type: 'CCS', powerKw: 50, pricePerKwh: 2.10, status: 'AVAILABLE' },
        { id: '7', type: 'CHAdeMO', powerKw: 50, pricePerKwh: 2.10, status: 'AVAILABLE' },
      ]
    },
    {
      id: 'CP_004',
      name: 'Wilanów Royal',
      address: 'Klimczaka 1',
      city: 'Warszawa',
      latitude: 52.1600,
      longitude: 21.0800,
      connectors: [
        { id: '8', type: 'CCS', powerKw: 350, pricePerKwh: 3.50, status: 'AVAILABLE' },
        { id: '9', type: 'CCS', powerKw: 350, pricePerKwh: 3.50, status: 'AVAILABLE' },
        { id: '10', type: 'CCS', powerKw: 350, pricePerKwh: 3.50, status: 'FAULTED' }, // Test awarii
        { id: '11', type: 'CCS', powerKw: 350, pricePerKwh: 3.50, status: 'AVAILABLE' },
      ]
    },
    {
      id: 'CP_005',
      name: 'Praga Koneser',
      address: 'Plac Konesera 2',
      city: 'Warszawa',
      latitude: 52.2560,
      longitude: 21.0450,
      connectors: [
        { id: '12', type: 'Type2', powerKw: 22, pricePerKwh: 1.60, status: 'AVAILABLE' },
      ]
    }
  ]

  // 3. Wstawianie danych w pętli
  for (const station of stationsData) {
    // Oblicz średnią cenę z connectorów
    const avgPrice = station.connectors.reduce((sum, c) => sum + c.pricePerKwh, 0) / station.connectors.length
    // Określ typ connectora (użyj najczęstszego lub "MIXED" jeśli różne)
    const connectorTypes = [...new Set(station.connectors.map(c => c.type))]
    const connectorType = connectorTypes.length === 1 ? connectorTypes[0] : 'MIXED'
    
    await prisma.station.create({
      data: {
        id: station.id,
        name: station.name,
        status: 'AVAILABLE',
        connectorType: connectorType,
        pricePerKwh: avgPrice,
        address: station.address,
        city: station.city,
        latitude: station.latitude,
        longitude: station.longitude,
        connectors: {
          create: station.connectors
        }
      }
    })
  }

  console.log(`✅ Dodano ${stationsData.length} stacji i ich złącza.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })