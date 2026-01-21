import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PrinterService, PrinterInfo, isTauri } from '../../lib/tauri';
import { Button } from '../ui/Button';
import { toast } from 'sonner';
import { Select } from '../ui/Select';

export function PrinterSettings() {
  const { t } = useTranslation(['settings', 'common']);
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
      toast.error(t('settings.printer.loadFailed'));
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
      toast.error(t('settings.printer.selectPrompt'));
      return;
    }

    setLoading(true);
    try {
      await PrinterService.setPrinter(selectedPrinter);
      setCurrentPrinter(selectedPrinter);
      toast.success(t('settings.printer.saveSuccess'));
    } catch (error) {
      console.error('Failed to save printer:', error);
      toast.error(t('settings.printer.saveFailed'));
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
      toast.success(t('settings.printer.testPrintSuccess'));
    } catch (error) {
      console.error('Test print failed:', error);
      toast.error(t('settings.printer.testPrintFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!isDesktop) {
    return (
      <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-yellow-800">
          {t('settings.printer.desktopOnly1')} {t('settings.printer.desktopOnly2')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">{t('settings.printer.title')}</h3>
        <p className="text-sm text-slate-600 mb-4">
          {t('settings.printer.description')}
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            {t('settings.printer.selectPort')}
          </label>
          <div className="flex gap-2">
            <Select
              value={selectedPrinter || ''}
              onChange={(e) => setSelectedPrinter(e.target.value)}
              disabled={loading}
              className="flex-1"
            >
              <option value="">{t('settings.printer.selectPlaceholder')}</option>
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
              {t('common:buttons.refresh')}
            </Button>
          </div>
        </div>

        {currentPrinter && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">
              {t('settings.printer.currentPrinter')}: <strong>{currentPrinter}</strong>
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <Button
            onClick={handleSavePrinter}
            disabled={loading || !selectedPrinter || selectedPrinter === currentPrinter}
          >
            {t('settings.printer.saveConfig')}
          </Button>
          <Button
            onClick={handleTestPrint}
            disabled={loading || !currentPrinter}
            variant="outline"
          >
            {t('settings.printer.testPrint')}
          </Button>
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold mb-2">{t('settings.printer.setupTitle')}</h4>
        <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
          <li>{t('settings.printer.steps.connect')}</li>
          <li>{t('settings.printer.steps.refresh')}</li>
          <li>{t('settings.printer.steps.select')}</li>
          <li>{t('settings.printer.steps.save')}</li>
          <li>{t('settings.printer.steps.test')}</li>
        </ol>
      </div>

      <div className="border-t pt-4">
        <h4 className="text-sm font-semibold mb-2">{t('settings.printer.supportedTitle')}</h4>
        <p className="text-sm text-slate-600">
          {t('settings.printer.supportedDesc')}
        </p>
      </div>
    </div>
  );
}

export default PrinterSettings;
