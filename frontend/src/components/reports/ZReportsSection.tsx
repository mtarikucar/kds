import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import {
  useZReports,
  useZReport,
  useGenerateZReport,
  useSendZReportEmail,
  downloadZReportPdf,
} from '../../api/zReportsApi';
import { Card, CardContent } from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Spinner from '../ui/Spinner';
import { formatCurrency } from '../../lib/utils';
import {
  FileText,
  Download,
  Mail,
  Plus,
  Eye,
  CheckCircle,
  AlertCircle,
  DollarSign,
  ShoppingCart,
  CreditCard,
  Banknote,
} from 'lucide-react';
import { toast } from 'sonner';

const ZReportsSection = () => {
  const { t } = useTranslation(['reports', 'common']);
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [dateFilter, setDateFilter] = useState({ startDate: '', endDate: '' });
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInput, setEmailInput] = useState('');

  // Generate form state
  const [generateForm, setGenerateForm] = useState({
    reportDate: format(new Date(), 'yyyy-MM-dd'),
    cashDrawerOpening: 0,
    cashDrawerClosing: 0,
    notes: '',
  });

  const { data: reportsData, isLoading } = useZReports({
    page,
    limit: 10,
    startDate: dateFilter.startDate || undefined,
    endDate: dateFilter.endDate || undefined,
  });

  const { data: selectedReport, isLoading: reportLoading } = useZReport(
    selectedReportId || ''
  );

  const generateMutation = useGenerateZReport();
  const sendEmailMutation = useSendZReportEmail();

  const handleGenerate = async () => {
    try {
      await generateMutation.mutateAsync({
        reportDate: generateForm.reportDate,
        cashDrawerOpening: generateForm.cashDrawerOpening,
        cashDrawerClosing: generateForm.cashDrawerClosing,
        notes: generateForm.notes || undefined,
      });
      toast.success(t('zReports.generateSuccess', 'Z-Report generated successfully'));
      setShowGenerateModal(false);
      queryClient.invalidateQueries({ queryKey: ['z-reports'] });
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('zReports.generateError', 'Failed to generate Z-Report'));
    }
  };

  const handleSendEmail = async () => {
    if (!selectedReportId) return;

    const emails = emailInput.split(',').map((e) => e.trim()).filter((e) => e);

    try {
      const result = await sendEmailMutation.mutateAsync({
        id: selectedReportId,
        emails: emails.length > 0 ? emails : undefined,
      });

      if (result.success) {
        toast.success(result.message);
        setShowEmailModal(false);
        setEmailInput('');
        queryClient.invalidateQueries({ queryKey: ['z-reports'] });
      } else {
        toast.error(result.message);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('zReports.emailError', 'Failed to send email'));
    }
  };

  const StatBox = ({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) => (
    <div className={`p-4 rounded-lg ${color}`}>
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-white" />
        <div>
          <p className="text-sm text-white/80">{label}</p>
          <p className="text-xl font-bold text-white">{value}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {/* Header with Generate Button */}
      <div className="mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <p className="text-gray-600">
            {t('zReports.description', 'End-of-day reconciliation reports')}
          </p>
        </div>
        <Button onClick={() => setShowGenerateModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          {t('zReports.generateNew', 'Generate Z-Report')}
        </Button>
      </div>

      {/* Date Filters */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <Input
                label={t('common:from', 'From')}
                type="date"
                value={dateFilter.startDate}
                onChange={(e) =>
                  setDateFilter((prev) => ({ ...prev, startDate: e.target.value }))
                }
              />
            </div>
            <div className="flex-1">
              <Input
                label={t('common:to', 'To')}
                type="date"
                value={dateFilter.endDate}
                onChange={(e) =>
                  setDateFilter((prev) => ({ ...prev, endDate: e.target.value }))
                }
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setDateFilter({ startDate: '', endDate: '' })}
            >
              {t('common:clear', 'Clear')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reports List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">
                      {t('zReports.reportNumber', 'Report #')}
                    </th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">
                      {t('zReports.date', 'Date')}
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">
                      {t('zReports.netSales', 'Net Sales')}
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">
                      {t('zReports.totalOrders', 'Orders')}
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-gray-700">
                      {t('zReports.status', 'Status')}
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">
                      {t('common:actions', 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reportsData?.data.map((report) => (
                    <tr
                      key={report.id}
                      className="border-b hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-blue-600">
                        {report.reportNumber}
                      </td>
                      <td className="py-3 px-4">
                        {format(new Date(report.reportDate), 'MMM dd, yyyy')}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-green-600">
                        {formatCurrency(report.netSales)}
                      </td>
                      <td className="py-3 px-4 text-right">{report.totalOrders}</td>
                      <td className="py-3 px-4 text-center">
                        {report.status === 'CLOSED' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {t('zReports.finalized', 'Finalized')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            {t('zReports.open', 'Open')}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedReportId(report.id)}
                            title={t('zReports.viewDetails', 'View Details')}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadZReportPdf(report.id, report.reportNumber)}
                            title={t('zReports.downloadPdf', 'Download PDF')}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedReportId(report.id);
                              setShowEmailModal(true);
                            }}
                            title={t('zReports.sendEmail', 'Send Email')}
                          >
                            <Mail className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {reportsData?.data.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-500">
                        <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p>{t('zReports.noReports', 'No Z-Reports found')}</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {reportsData && reportsData.pages > 1 && (
              <div className="p-4 border-t flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  {t('common:showingPage', 'Page {{page}} of {{total}}', {
                    page,
                    total: reportsData.pages,
                  })}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    {t('common:previous', 'Previous')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPage((p) => Math.min(reportsData.pages, p + 1))}
                    disabled={page === reportsData.pages}
                  >
                    {t('common:next', 'Next')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* View Report Modal */}
      <Modal
        isOpen={!!selectedReportId && !showEmailModal}
        onClose={() => setSelectedReportId(null)}
        title={`Z-Report: ${selectedReport?.reportNumber || ''}`}
      >
        {reportLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : selectedReport ? (
          <div className="space-y-6">
            {/* Key Stats */}
            <div className="grid grid-cols-2 gap-4">
              <StatBox
                label={t('zReports.netSales', 'Net Sales')}
                value={formatCurrency(selectedReport.netSales)}
                icon={DollarSign}
                color="bg-green-500"
              />
              <StatBox
                label={t('zReports.totalOrders', 'Total Orders')}
                value={selectedReport.totalOrders}
                icon={ShoppingCart}
                color="bg-blue-500"
              />
            </div>

            {/* Sales Summary */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold mb-3">{t('zReports.salesSummary', 'Sales Summary')}</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('zReports.grossSales', 'Gross Sales')}</span>
                  <span className="font-medium">{formatCurrency(selectedReport.grossSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('zReports.discounts', 'Discounts')}</span>
                  <span className="font-medium text-red-600">-{formatCurrency(selectedReport.discounts)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="font-semibold">{t('zReports.netSales', 'Net Sales')}</span>
                  <span className="font-bold text-green-600">{formatCurrency(selectedReport.netSales)}</span>
                </div>
              </div>
            </div>

            {/* Payment Methods */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold mb-3">{t('zReports.paymentMethods', 'Payment Methods')}</h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-green-600" />
                    <span className="text-gray-600">{t('zReports.cash', 'Cash')}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(selectedReport.cashPayments)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-blue-600" />
                    <span className="text-gray-600">{t('zReports.card', 'Card')}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(selectedReport.cardPayments)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-purple-600" />
                    <span className="text-gray-600">{t('zReports.digital', 'Digital')}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(selectedReport.digitalPayments)}</span>
                </div>
              </div>
            </div>

            {/* Cash Drawer */}
            <div className={`rounded-lg p-4 ${
              selectedReport.cashDifference === 0 ? 'bg-green-50' :
              selectedReport.cashDifference < 0 ? 'bg-red-50' : 'bg-yellow-50'
            }`}>
              <h4 className="font-semibold mb-3">{t('zReports.cashDrawer', 'Cash Drawer')}</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('zReports.opening', 'Opening')}</span>
                  <span className="font-medium">{formatCurrency(selectedReport.cashDrawerOpening)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('zReports.expected', 'Expected')}</span>
                  <span className="font-medium">{formatCurrency(selectedReport.expectedCash)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{t('zReports.counted', 'Counted')}</span>
                  <span className="font-medium">{formatCurrency(selectedReport.cashDrawerClosing)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="font-semibold">{t('zReports.difference', 'Difference')}</span>
                  <span className={`font-bold ${
                    selectedReport.cashDifference === 0 ? 'text-green-600' :
                    selectedReport.cashDifference < 0 ? 'text-red-600' : 'text-yellow-600'
                  }`}>
                    {formatCurrency(selectedReport.cashDifference)}
                  </span>
                </div>
              </div>
            </div>

            {/* Top Products */}
            {selectedReport.topProducts && selectedReport.topProducts.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold mb-3">{t('zReports.topProducts', 'Top Products')}</h4>
                <div className="space-y-2">
                  {selectedReport.topProducts.slice(0, 5).map((product: any, index: number) => (
                    <div key={index} className="flex justify-between items-center">
                      <span className="text-gray-600">{product.name}</span>
                      <div className="text-right">
                        <span className="font-medium">{formatCurrency(product.revenue)}</span>
                        <span className="text-xs text-gray-500 ml-2">({product.quantity} sold)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t">
              <Button
                className="flex-1"
                onClick={() => downloadZReportPdf(selectedReport.id, selectedReport.reportNumber)}
              >
                <Download className="w-4 h-4 mr-2" />
                {t('zReports.downloadPdf', 'Download PDF')}
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                onClick={() => {
                  setShowEmailModal(true);
                }}
              >
                <Mail className="w-4 h-4 mr-2" />
                {t('zReports.sendEmail', 'Send Email')}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Generate Report Modal */}
      <Modal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        title={t('zReports.generateNew', 'Generate Z-Report')}
      >
        <div className="space-y-4">
          <Input
            label={t('zReports.reportDate', 'Report Date')}
            type="date"
            value={generateForm.reportDate}
            onChange={(e) =>
              setGenerateForm((prev) => ({ ...prev, reportDate: e.target.value }))
            }
          />
          <Input
            label={t('zReports.cashOpening', 'Cash Drawer Opening')}
            type="number"
            min="0"
            step="0.01"
            value={generateForm.cashDrawerOpening}
            onChange={(e) =>
              setGenerateForm((prev) => ({
                ...prev,
                cashDrawerOpening: parseFloat(e.target.value) || 0,
              }))
            }
          />
          <Input
            label={t('zReports.cashClosing', 'Cash Drawer Closing')}
            type="number"
            min="0"
            step="0.01"
            value={generateForm.cashDrawerClosing}
            onChange={(e) =>
              setGenerateForm((prev) => ({
                ...prev,
                cashDrawerClosing: parseFloat(e.target.value) || 0,
              }))
            }
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('zReports.notes', 'Notes')}
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              value={generateForm.notes}
              onChange={(e) =>
                setGenerateForm((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder={t('zReports.notesPlaceholder', 'Optional notes...')}
            />
          </div>
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowGenerateModal(false)}
            >
              {t('common:buttons.cancel', 'Cancel')}
            </Button>
            <Button
              className="flex-1"
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <Spinner className="w-4 h-4" />
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  {t('zReports.generate', 'Generate')}
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Send Email Modal */}
      <Modal
        isOpen={showEmailModal}
        onClose={() => {
          setShowEmailModal(false);
          setEmailInput('');
        }}
        title={t('zReports.sendEmailTitle', 'Send Z-Report via Email')}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {t('zReports.emailDescription', 'Leave empty to use default recipients from tenant settings, or enter custom email addresses.')}
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('zReports.emailRecipients', 'Email Recipients')}
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder={t('zReports.emailPlaceholder', 'admin@example.com, manager@example.com')}
            />
            <p className="text-xs text-gray-500 mt-1">
              {t('zReports.emailHint', 'Separate multiple emails with commas')}
            </p>
          </div>
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowEmailModal(false);
                setEmailInput('');
              }}
            >
              {t('common:buttons.cancel', 'Cancel')}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSendEmail}
              disabled={sendEmailMutation.isPending}
            >
              {sendEmailMutation.isPending ? (
                <Spinner className="w-4 h-4" />
              ) : (
                <>
                  <Mail className="w-4 h-4 mr-2" />
                  {t('zReports.send', 'Send')}
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ZReportsSection;
