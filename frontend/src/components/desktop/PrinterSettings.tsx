import { useState, useEffect } from 'react';
import { PrinterService, PrinterInfo, isTauri } from '../../lib/tauri';
import { Button } from '../ui/Button';
import { toast } from 'sonner';
import { Select } from '../ui/Select';

export function PrinterSettings() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string | null>(null);
  const [currentPrinter, setCurrentPrinter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Check if running in Tauri
  const isDesktop = isTauri();

  useEffect(() => {
    if (isDesktop) {
      loadPrinters();
      loadCurrentPrinter();
    }
  }, [isDesktop]);

  const loadPrinters = async () => {
    setLoading(true);
    try {
      const printerList = await PrinterService.listPrinters();
      setPrinters(printerList);
    } catch (error) {
      console.error('Failed to load printers:', error);
      toast.error('Failed to load printers');
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentPrinter = async () => {
    try {
      const printer = await PrinterService.getPrinter();
      setCurrentPrinter(printer);
      setSelectedPrinter(printer);
    } catch (error) {
      console.error('Failed to get current printer:', error);
    }
  };

  const handleSavePrinter = async () => {
    if (!selectedPrinter) {
      toast.error('Please select a printer');
      return;
    }

    setLoading(true);
    try {
      await PrinterService.setPrinter(selectedPrinter);
      setCurrentPrinter(selectedPrinter);
      toast.success('Printer configuration saved');
    } catch (error) {
      console.error('Failed to save printer:', error);
      toast.error('Failed to save printer configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleTestPrint = async () => {
    setLoading(true);
    try {
      const testReceipt = {
        order_id: 'TEST-001',
        items: [
          { name: 'Test Item', quantity: 1, price: 10.00 }
        ],
        total: 10.00,
        payment_method: 'Test',
        table_number: 'Test Table'
      };

      await PrinterService.printReceipt(testReceipt);
      toast.success('Test print sent to printer');
    } catch (error) {
      console.error('Test print failed:', error);
      toast.error('Test print failed');
    } finally {
      setLoading(false);
    }
  };

  if (!isDesktop) {
    return (
      <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-yellow-800">
          Printer settings are only available in the desktop application.
          Download the desktop app to enable thermal printer support.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Printer Configuration</h3>
        <p className="text-sm text-gray-600 mb-4">
          Configure thermal printers for receipts and kitchen orders.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Printer Port
          </label>
          <div className="flex gap-2">
            <Select
              value={selectedPrinter || ''}
              onChange={(e) => setSelectedPrinter(e.target.value)}
              disabled={loading}
              className="flex-1"
            >
              <option value="">Select a printer...</option>
              {printers.map((printer) => (
                <option key={printer.port} value={printer.port}>
                  {printer.name} ({printer.status})
                </option>
              ))}
            </Select>
            <Button
              onClick={loadPrinters}
              disabled={loading}
              variant="outline"
            >
              Refresh
            </Button>
          </div>
        </div>

        {currentPrinter && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">
              Current printer: <strong>{currentPrinter}</strong>
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <Button
            onClick={handleSavePrinter}
            disabled={loading || !selectedPrinter || selectedPrinter === currentPrinter}
          >
            Save Configuration
          </Button>
          <Button
            onClick={handleTestPrint}
            disabled={loading || !currentPrinter}
            variant="outline"
          >
            Test Print
          </Button>
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold mb-2">Printer Setup Instructions</h4>
        <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
          <li>Connect your thermal printer via USB or Serial port</li>
          <li>Click "Refresh" to scan for available printers</li>
          <li>Select your printer from the dropdown</li>
          <li>Click "Save Configuration"</li>
          <li>Use "Test Print" to verify the connection</li>
        </ol>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold mb-2">Supported Printers</h4>
        <p className="text-sm text-gray-600">
          This application supports ESC/POS compatible thermal printers including:
          Epson TM series, Star TSP series, and generic ESC/POS printers.
        </p>
      </div>
    </div>
  );
}

export default PrinterSettings;
