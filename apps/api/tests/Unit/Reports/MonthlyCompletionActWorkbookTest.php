<?php

namespace Tests\Unit\Reports;

use App\Domain\Reports\MonthlyCompletionActWorkbook;
use PHPUnit\Framework\TestCase;

final class MonthlyCompletionActWorkbookTest extends TestCase
{
    public function test_it_builds_a_six_sheet_monthly_act_with_frozen_source_values(): void
    {
        $payload = [
            'actNumber' => 'D001-2026-08-001',
            'period' => '2026-08',
            'divisionName' => '=Toshkent halqa yo‘li 1-yo‘l bo‘limi',
            'roadLabel' => 'D001 · 0+000–67+000',
            'state' => 'APPROVED',
            'preparedBy' => 'Yo‘l ustasi',
            'approvedBy' => 'Bo‘lim boshlig‘i',
            'items' => [[
                'orderNumber' => 'D001-45-01',
                'workCode' => 'K2-7',
                'workName' => '=Qoplamani tozalash',
                'normReference' => 'IQN 02-24 · K2-7',
                'unit' => '100 m²',
                'annualPlannedQuantity' => 100.0,
                'monthQuantity' => 12.0,
                'monthAmount' => 1746000.0,
                'iqnUnitLaborMinutes' => 30.0,
                'iqnTotalLaborMinutes' => 360.0,
                'yearToDateQuantity' => 48.0,
                'yearToDateAmount' => 6984000.0,
                'ytdGroupKey' => 'annual:program-item-1',
            ]],
            'labor' => [
                [
                    'orderNumber' => 'D001-45-01',
                    'workDate' => '2026-08-12',
                    'personnelNumber' => 'D001-014',
                    'fullName' => '=Aziz Shermatov',
                    'positionName' => 'Yo‘l ishchisi',
                    'actualMinutes' => 960,
                    'rateBasis' => 'monthly_salary',
                    'unitRate' => 4200000.0,
                    'normWorkingDays' => 22,
                    'normMinutes' => 10560,
                    'bonusRateBps' => 1000,
                    'trafficAllowanceRateBps' => 2000,
                    'travelAllowanceRateBps' => 500,
                    'socialContributionRateBps' => 1200,
                    'wageAmount' => 400000.0,
                    'bonusAmount' => 40000.0,
                    'trafficAllowanceAmount' => 80000.0,
                    'travelAllowanceAmount' => 20000.0,
                    'allowanceAmount' => 140000.0,
                    'socialAmount' => 64800.0,
                    'totalAmount' => 604800.0,
                ],
                [
                    'orderNumber' => 'D001-45-01',
                    'workDate' => '2026-08-13',
                    'personnelNumber' => 'D001-014',
                    'fullName' => '=Aziz Shermatov',
                    'positionName' => 'Yo‘l ishchisi',
                    'actualMinutes' => 240,
                    'rateBasis' => 'monthly_salary',
                    'unitRate' => 4200000.0,
                    'normWorkingDays' => 22,
                    'normMinutes' => 10560,
                    'bonusRateBps' => 1000,
                    'trafficAllowanceRateBps' => 2000,
                    'travelAllowanceRateBps' => 500,
                    'socialContributionRateBps' => 1200,
                    'wageAmount' => 100000.0,
                    'bonusAmount' => 10000.0,
                    'trafficAllowanceAmount' => 20000.0,
                    'travelAllowanceAmount' => 5000.0,
                    'allowanceAmount' => 35000.0,
                    'socialAmount' => 16200.0,
                    'totalAmount' => 151200.0,
                ],
            ],
            'materials' => [[
                'orderNumber' => 'D001-45-01',
                'code' => 'MAT-001',
                'name' => '=Supurgi',
                'unit' => 'dona',
                'quantity' => 2.0,
                'unitPrice' => 120000.0,
                'amount' => 240000.0,
            ]],
            'equipment' => [[
                'orderNumber' => 'D001-45-01',
                'inventoryCode' => 'EQ-001',
                'name' => 'Supuruvchi mashina',
                'machineMinutes' => 180,
                'machineHourRate' => 250000.0,
                'amount' => 750000.0,
            ]],
            'totals' => [
                'labor' => 675000.0,
                'social' => 81000.0,
                'materials' => 240000.0,
                'equipment' => 750000.0,
                'transport' => 0.0,
                'other' => 0.0,
                'subtotal' => 1746000.0,
                'vat' => 0.0,
                'grandTotal' => 1746000.0,
            ],
        ];
        $workbook = (new MonthlyCompletionActWorkbook)->build($payload);

        self::assertSame(
            ['Dalolatnoma', 'Ish haqi', 'Tabel', 'Materiallar', 'Mashina-mexanizm', 'Umumiy xarajat'],
            $workbook->getSheetNames(),
        );
        self::assertSame('IQN ish kodi', $workbook->getSheet(0)->getCell('C5')->getValue());
        self::assertSame('IQN birlik normasi, ishchi-soat/birlik', $workbook->getSheet(0)->getCell('I5')->getValue());
        self::assertSame('Jami normativ mehnat, ishchi-soat', $workbook->getSheet(0)->getCell('J5')->getValue());
        self::assertSame('Haqiqiy mehnat, ishchi-soat', $workbook->getSheet(0)->getCell('K5')->getValue());
        self::assertSame('K2-7', $workbook->getSheet(0)->getCell('C6')->getValue());
        self::assertSame('=Qoplamani tozalash', $workbook->getSheet(0)->getCell('D6')->getValue());
        self::assertSame('s', $workbook->getSheet(0)->getCell('D6')->getDataType());
        self::assertSame('s', $workbook->getSheet(0)->getCell('A2')->getDataType());
        self::assertSame(12.0, $workbook->getSheet(0)->getCell('H6')->getValue());
        self::assertSame(0.5, $workbook->getSheet(0)->getCell('I6')->getValue());
        self::assertSame(6.0, $workbook->getSheet(0)->getCell('J6')->getValue());
        self::assertSame(20.0, $workbook->getSheet(0)->getCell('K6')->getValue());
        self::assertSame(675000.0, $workbook->getSheet(0)->getCell('P6')->getValue());
        self::assertSame(81000.0, $workbook->getSheet(0)->getCell('Q6')->getValue());
        self::assertSame(240000.0, $workbook->getSheet(0)->getCell('R6')->getValue());
        self::assertSame(750000.0, $workbook->getSheet(0)->getCell('S6')->getValue());
        self::assertSame(1746000.0, $workbook->getSheet(0)->getCell('T6')->getValue());
        self::assertSame('=SUM(J6:J6)', $workbook->getSheet(0)->getCell('J7')->getValue());
        self::assertSame('=SUM(T6:T6)', $workbook->getSheet(0)->getCell('T7')->getValue());

        $labor = $workbook->getSheetByName('Ish haqi');
        self::assertSame('Malaka darajasi', $labor?->getCell('F5')->getValue());
        self::assertSame('Bayram puli (qayd etilmagan)', $labor?->getCell('T5')->getValue());
        self::assertSame('Ijtimoiy ajratma', $labor?->getCell('X5')->getValue());
        self::assertSame('D001-014', $labor?->getCell('B6')->getValue());
        self::assertSame('=Aziz Shermatov', $labor?->getCell('C6')->getValue());
        self::assertSame('s', $labor?->getCell('C6')->getDataType());
        self::assertSame('Qayd etilmagan', $labor?->getCell('F6')->getValue());
        self::assertSame('Qayd etilmagan', $labor?->getCell('G6')->getValue());
        self::assertSame(22.0, $labor?->getCell('H6')->getValue());
        self::assertSame(176.0, $labor?->getCell('I6')->getValue());
        self::assertSame(2.0, $labor?->getCell('J6')->getValue());
        self::assertSame(20.0, $labor?->getCell('K6')->getValue());
        self::assertSame(4200000.0, $labor?->getCell('L6')->getValue());
        self::assertSame(500000.0, $labor?->getCell('M6')->getValue());
        self::assertSame(10.0, $labor?->getCell('N6')->getValue());
        self::assertSame(50000.0, $labor?->getCell('O6')->getValue());
        self::assertSame(20.0, $labor?->getCell('P6')->getValue());
        self::assertSame(100000.0, $labor?->getCell('Q6')->getValue());
        self::assertSame(5.0, $labor?->getCell('R6')->getValue());
        self::assertSame(25000.0, $labor?->getCell('S6')->getValue());
        self::assertSame(0.0, $labor?->getCell('T6')->getValue());
        self::assertSame(0.0, $labor?->getCell('U6')->getValue());
        self::assertSame(675000.0, $labor?->getCell('V6')->getValue());
        self::assertSame(12.0, $labor?->getCell('W6')->getValue());
        self::assertSame(81000.0, $labor?->getCell('X6')->getValue());
        self::assertSame(756000.0, $labor?->getCell('Y6')->getValue());
        self::assertSame('=SUM(Y6:Y6)', $labor?->getCell('Y7')->getValue());

        $timesheet = $workbook->getSheetByName('Tabel');
        self::assertSame(1, $timesheet?->getCell('E6')->getValue());
        self::assertSame(31, $timesheet?->getCell('AI6')->getValue());
        self::assertSame('Oy ish kuni', $timesheet?->getCell('AJ5')->getValue());
        self::assertSame('=Aziz Shermatov', $timesheet?->getCell('C7')->getValue());
        self::assertSame('s', $timesheet?->getCell('C7')->getDataType());
        self::assertSame(16.0, $timesheet?->getCell('P7')->getValue());
        self::assertSame(4.0, $timesheet?->getCell('Q7')->getValue());
        self::assertSame(2.0, $timesheet?->getCell('AJ7')->getValue());
        self::assertSame(20.0, $timesheet?->getCell('AK7')->getValue());
        self::assertSame(0.0, $timesheet?->getCell('AL7')->getValue());
        self::assertSame(20.0, $timesheet?->getCell('AM7')->getValue());
        self::assertSame('=SUM(AM7:AM7)', $timesheet?->getCell('AM8')->getValue());

        $materials = $workbook->getSheetByName('Materiallar');
        self::assertSame('Birlik narxi, so‘m', $materials?->getCell('G5')->getValue());
        self::assertSame('D001-45-01', $materials?->getCell('B6')->getValue());
        self::assertSame('MAT-001', $materials?->getCell('C6')->getValue());
        self::assertSame('=Supurgi', $materials?->getCell('D6')->getValue());
        self::assertSame('s', $materials?->getCell('D6')->getDataType());
        self::assertSame(2.0, $materials?->getCell('F6')->getValue());
        self::assertSame(120000.0, $materials?->getCell('G6')->getValue());
        self::assertSame(240000.0, $materials?->getCell('H6')->getValue());
        self::assertSame('=SUM(H6:H6)', $materials?->getCell('H7')->getValue());

        $equipment = $workbook->getSheetByName('Mashina-mexanizm');
        self::assertSame('1 mashina-soat narxi', $equipment?->getCell('F5')->getValue());
        self::assertSame('D001-45-01', $equipment?->getCell('B6')->getValue());
        self::assertSame('EQ-001', $equipment?->getCell('C6')->getValue());
        self::assertSame(3.0, $equipment?->getCell('E6')->getValue());
        self::assertSame(250000.0, $equipment?->getCell('F6')->getValue());
        self::assertSame(750000.0, $equipment?->getCell('G6')->getValue());
        self::assertSame('=SUM(G6:G6)', $equipment?->getCell('G7')->getValue());

        $summary = $workbook->getSheetByName('Umumiy xarajat');
        self::assertSame(0.0, $summary?->getCell('D10')->getValue());
        self::assertSame(0.0, $summary?->getCell('D13')->getValue());
        self::assertSame(1746000.0, $summary?->getCell('D14')->getValue());

        $workbook->disconnectWorksheets();

        $groupedYtdPayload = $payload;
        $groupedYtdPayload['items'][0]['ytdGroupKey'] = 'annual:program-item-1';
        $secondItem = $groupedYtdPayload['items'][0];
        $secondItem['orderNumber'] = 'D001-45-02';
        $secondItem['monthQuantity'] = 3.0;
        $secondItem['monthAmount'] = 300000.0;
        $groupedYtdPayload['items'][] = $secondItem;
        $groupedYtd = (new MonthlyCompletionActWorkbook)->build($groupedYtdPayload);
        $groupedYtdSheet = $groupedYtd->getSheetByName('Dalolatnoma');
        self::assertSame(6984000.0, $groupedYtdSheet?->getCell('N6')->getValue());
        self::assertNull($groupedYtdSheet?->getCell('M7')->getValue());
        self::assertNull($groupedYtdSheet?->getCell('N7')->getValue());
        self::assertNull($groupedYtdSheet?->getCell('O7')->getValue());
        self::assertSame('=SUM(N6:N7)', $groupedYtdSheet?->getCell('N8')->getValue());
        $groupedYtd->disconnectWorksheets();

        $aggregatedPayload = $payload;
        $aggregatedPayload['items'][0]['aggregationKey'] = 'road-1:variant-1:100 m2';
        $aggregatedSecond = $aggregatedPayload['items'][0];
        $aggregatedSecond['orderNumber'] = 'D001-45-02';
        $aggregatedSecond['monthQuantity'] = 3.0;
        $aggregatedSecond['monthAmount'] = 300000.0;
        $aggregatedSecond['iqnTotalLaborMinutes'] = 90.0;
        $aggregatedPayload['items'][] = $aggregatedSecond;
        $aggregated = (new MonthlyCompletionActWorkbook)->build($aggregatedPayload);
        $aggregatedSheet = $aggregated->getSheetByName('Dalolatnoma');
        self::assertSame('D001-45-01, D001-45-02', $aggregatedSheet?->getCell('B6')->getValue());
        self::assertSame(15.0, $aggregatedSheet?->getCell('H6')->getValue());
        self::assertSame(0.5, $aggregatedSheet?->getCell('I6')->getValue());
        self::assertSame(7.5, $aggregatedSheet?->getCell('J6')->getValue());
        self::assertSame(2046000.0, $aggregatedSheet?->getCell('T6')->getValue());
        self::assertSame('JAMI', $aggregatedSheet?->getCell('A7')->getValue());
        $aggregated->disconnectWorksheets();

        $mixedYtdPayload = $aggregatedPayload;
        $mixedYtdPayload['items'][1]['ytdGroupKey'] = 'annual:program-item-2';
        $mixedYtdPayload['items'][1]['annualPlannedQuantity'] = 40.0;
        $mixedYtdPayload['items'][1]['yearToDateQuantity'] = 10.0;
        $mixedYtdPayload['items'][1]['yearToDateAmount'] = 1200000.0;
        $mixedYtd = (new MonthlyCompletionActWorkbook)->build($mixedYtdPayload);
        $mixedYtdSheet = $mixedYtd->getSheetByName('Dalolatnoma');
        self::assertSame(140.0, $mixedYtdSheet?->getCell('G6')->getValue());
        self::assertSame(58.0, $mixedYtdSheet?->getCell('M6')->getValue());
        self::assertSame(8184000.0, $mixedYtdSheet?->getCell('N6')->getValue());
        $mixedYtd->disconnectWorksheets();

        $legacyPayload = $aggregatedPayload;
        $legacyPayload['items'][0]['iqnUnitLaborMinutes'] = null;
        $legacyPayload['items'][0]['iqnTotalLaborMinutes'] = null;
        $legacy = (new MonthlyCompletionActWorkbook)->build($legacyPayload);
        $legacySheet = $legacy->getSheetByName('Dalolatnoma');
        self::assertNull($legacySheet?->getCell('I6')->getValue());
        self::assertNull($legacySheet?->getCell('J6')->getValue());
        self::assertNull($legacySheet?->getCell('J7')->getValue());
        self::assertStringContainsString(
            'Eski muzlatilgan snapshotlarda IQN normativ mehnati mavjud emas',
            (string) $legacySheet?->getCell('A3')->getValue(),
        );
        $legacy->disconnectWorksheets();

        $outsidePeriodPayload = $payload;
        $outsidePeriodPayload['labor'][1]['workDate'] = '2026-07-31';
        $outsidePeriod = (new MonthlyCompletionActWorkbook)->build($outsidePeriodPayload);
        $outsideTimesheet = $outsidePeriod->getSheetByName('Tabel');
        self::assertNull($outsideTimesheet?->getCell('Q7')->getValue());
        self::assertSame(1.0, $outsideTimesheet?->getCell('AJ7')->getValue());
        self::assertSame(16.0, $outsideTimesheet?->getCell('AK7')->getValue());
        self::assertSame(4.0, $outsideTimesheet?->getCell('AL7')->getValue());
        self::assertSame(20.0, $outsideTimesheet?->getCell('AM7')->getValue());
        $outsidePeriod->disconnectWorksheets();

        $payload['materials'] = [];
        $payload['equipment'] = [];
        $emptyResources = (new MonthlyCompletionActWorkbook)->build($payload);
        self::assertSame(0.0, $emptyResources->getSheetByName('Materiallar')?->getCell('H6')->getValue());
        self::assertSame(0.0, $emptyResources->getSheetByName('Mashina-mexanizm')?->getCell('G6')->getValue());
        $emptyResources->disconnectWorksheets();
    }
}
