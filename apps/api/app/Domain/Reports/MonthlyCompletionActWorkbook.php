<?php

namespace App\Domain\Reports;

use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Worksheet\PageSetup;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

final class MonthlyCompletionActWorkbook
{
    private const NAVY = 'FF073451';

    private const BLUE = 'FF0B66C3';

    private const LIGHT_BLUE = 'FFEAF3FF';

    private const LIGHT_GRAY = 'FFF3F6F8';

    private const WHITE = 'FFFFFFFF';

    /**
     * @param  array{
     *   actNumber:string,
     *   period:string,
     *   divisionName:string,
     *   roadLabel:string,
     *   state:string,
     *   preparedBy:string,
     *   approvedBy:?string,
     *   items:list<array{
     *     orderNumber:string,aggregationKey?:string,workCode:string,workName:string,normReference:string,unit:string,
     *     annualPlannedQuantity:float,monthQuantity:float,monthAmount:float,
     *     yearToDateQuantity:float,yearToDateAmount:float,ytdGroupKey:string,
     *     iqnUnitLaborMinutes:?float,iqnTotalLaborMinutes:?float
     *   }>,
     *   labor:list<array{
     *     orderNumber:string,workDate:string,personnelNumber:string,fullName:string,
     *     positionName:string,actualMinutes:int,rateBasis:string,unitRate:float,
     *     normWorkingDays:int,normMinutes:int,bonusRateBps:int,trafficAllowanceRateBps:int,
     *     travelAllowanceRateBps:int,socialContributionRateBps:int,wageAmount:float,
     *     bonusAmount:float,trafficAllowanceAmount:float,travelAllowanceAmount:float,
     *     allowanceAmount:float,socialAmount:float,totalAmount:float
     *   }>,
     *   materials:list<array{orderNumber:string,code:string,name:string,unit:string,quantity:float,unitPrice:float,amount:float}>,
     *   equipment:list<array{orderNumber:string,inventoryCode:string,name:string,machineMinutes:int,machineHourRate:float,amount:float}>,
     *   totals:array{labor:float,social:float,materials:float,equipment:float,transport:float,other:float,subtotal:float,vat:float,grandTotal:float}
     * }  $act
     */
    public function build(array $act): Spreadsheet
    {
        $workbook = new Spreadsheet;
        $workbook->getProperties()
            ->setTitle('Bajarilgan ishlar dalolatnomasi '.$act['period'])
            ->setSubject('IQN 02-24 va IQN 03-24 asosidagi oylik bajarilgan ishlar hisoboti')
            ->setCreator('Yagona yo‘l');

        $this->buildActSheet($workbook->getActiveSheet(), $act);
        $this->buildLaborSheet($workbook->createSheet(), $act);
        $this->buildTimesheetSheet($workbook->createSheet(), $act);
        $this->buildMaterialSheet($workbook->createSheet(), $act);
        $this->buildEquipmentSheet($workbook->createSheet(), $act);
        $this->buildSummarySheet($workbook->createSheet(), $act);
        $workbook->setActiveSheetIndex(0);

        return $workbook;
    }

    /** @param array<string, mixed> $act */
    private function buildActSheet(Worksheet $sheet, array $act): void
    {
        $hasLegacyIqnNorm = false;
        foreach ($act['items'] as $item) {
            if (($item['iqnTotalLaborMinutes'] ?? null) === null) {
                $hasLegacyIqnNorm = true;
                break;
            }
        }

        $sheet->setTitle('Dalolatnoma');
        $sheet->mergeCells('A1:T1');
        $sheet->setCellValue('A1', 'BAJARILGAN ISHLAR QIYMATI TO‘G‘RISIDA OYLIK DALOLATNOMA');
        $sheet->mergeCells('A2:T2');
        $this->setSafeText($sheet, 'A2', sprintf(
            '%s · %s · %s · Dalolatnoma № %s',
            $act['divisionName'],
            $act['roadLabel'],
            $act['period'],
            $act['actNumber'],
        ));
        $sheet->mergeCells('A3:T3');
        $note = 'Bir yo‘l, IQN ish varianti va birlik bo‘yicha topshiriqlar jamlangan. IQN normativ va haqiqiy mehnat alohida ko‘rsatiladi; topshiriq raqamlari drill-down uchun saqlanadi.';
        if ($hasLegacyIqnNorm) {
            $note .= ' Eski muzlatilgan snapshotlarda IQN normativ mehnati mavjud emas; tegishli kataklar ataylab bo‘sh qoldirilgan.';
        }
        $sheet->setCellValue(
            'A3',
            $note,
        );

        $headers = [
            '№', 'Topshiriq', 'IQN ish kodi', 'Bajarilgan ish', 'IQN hujjat/asos', 'Birlik',
            'Yillik reja hajmi', 'Oy hajmi', 'IQN birlik normasi, ishchi-soat/birlik',
            'Jami normativ mehnat, ishchi-soat', 'Haqiqiy mehnat, ishchi-soat',
            'Oy qiymati, so‘m', 'Yil boshidan hajm', 'Yil boshidan qiymat, so‘m',
            'Yillik reja bajarilishi, %', 'Ish haqi', 'Ijtimoiy ajratma',
            'Material', 'Mashina-mexanizm', 'Jami, so‘m',
        ];
        $headerRow = 5;
        foreach ($headers as $index => $header) {
            $this->setSafeText($sheet, Coordinate::stringFromColumnIndex($index + 1).$headerRow, $header);
        }

        $row = $headerRow + 1;
        $seenYtdGroups = [];
        foreach ($this->aggregatedActItems($act['items']) as $index => $item) {
            $itemCosts = $this->itemCostShare($act, $item['orderNumbers']);
            $ytdGroupKey = (string) ($item['ytdGroupKey'] ?? 'order:'.$item['orderNumber']);
            $showYtd = ! isset($seenYtdGroups[$ytdGroupKey]);
            $seenYtdGroups[$ytdGroupKey] = true;
            $values = [
                $index + 1,
                $item['orderNumber'],
                $item['workCode'],
                $item['workName'],
                $item['normReference'],
                $item['unit'],
                $item['annualPlannedQuantity'],
                $item['monthQuantity'],
                $item['iqnUnitLaborMinutes'] === null ? null : $item['iqnUnitLaborMinutes'] / 60,
                $item['iqnTotalLaborMinutes'] === null ? null : $item['iqnTotalLaborMinutes'] / 60,
                $itemCosts['laborMinutes'] / 60,
                $item['monthAmount'],
                $showYtd ? $item['yearToDateQuantity'] : null,
                $showYtd ? $item['yearToDateAmount'] : null,
                $showYtd && $item['annualPlannedQuantity'] > 0
                    ? ($item['yearToDateQuantity'] / $item['annualPlannedQuantity']) * 100
                    : null,
                $itemCosts['labor'],
                $itemCosts['social'],
                $itemCosts['materials'],
                $itemCosts['equipment'],
                $item['monthAmount'],
            ];
            $this->writeRow($sheet, $row, $values, [1, 2, 3, 4, 5, 6]);
            $row++;
        }

        $totalRow = $row;
        $sheet->mergeCells("A{$totalRow}:I{$totalRow}");
        $sheet->setCellValue("A{$totalRow}", 'JAMI');
        if (! $hasLegacyIqnNorm) {
            $this->setTotalFormula($sheet, 'J', $totalRow);
        }
        foreach (['K', 'L', 'N', 'P', 'Q', 'R', 'S', 'T'] as $column) {
            $this->setTotalFormula($sheet, $column, $totalRow);
        }
        $sheet->getStyle("A{$totalRow}:T{$totalRow}")->getFont()->setBold(true);
        $sheet->getStyle("A{$totalRow}:T{$totalRow}")->getFill()
            ->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB(self::LIGHT_BLUE);

        $signatureRow = $totalRow + 3;
        $sheet->mergeCells("A{$signatureRow}:J{$signatureRow}");
        $sheet->mergeCells("K{$signatureRow}:T{$signatureRow}");
        $this->setSafeText($sheet, "A{$signatureRow}", 'Tuzuvchi: '.$act['preparedBy']);
        $this->setSafeText($sheet, "K{$signatureRow}", 'Tasdiqlovchi: '.($act['approvedBy'] ?? 'Tasdiqlanmagan'));

        $this->styleTitle($sheet, 'A1:T1');
        $this->styleSubtitle($sheet, 'A2:T3');
        $this->styleHeader($sheet, "A{$headerRow}:T{$headerRow}");
        $this->styleBody($sheet, "A{$headerRow}:T{$totalRow}");
        $sheet->getStyle("G6:T{$totalRow}")->getNumberFormat()->setFormatCode('#,##0.00');
        $sheet->getStyle("O6:O{$totalRow}")->getNumberFormat()->setFormatCode('0.00');
        $sheet->freezePane('A6');
        $sheet->setAutoFilter("A{$headerRow}:T".max($headerRow, $totalRow - 1));
        $this->setWidths($sheet, [6, 24, 16, 40, 20, 11, 15, 13, 20, 20, 18, 18, 16, 20, 16, 15, 16, 15, 18, 18]);
        $this->printLandscape($sheet, 'A1:T'.$signatureRow);
    }

    /** @param array<string, mixed> $act */
    private function buildLaborSheet(Worksheet $sheet, array $act): void
    {
        $sheet->setTitle('Ish haqi');
        $this->sheetHeading($sheet, 'Y', 'ISHCHILAR MEHNATI VA ISH HAQI HISOBI', $act);
        $this->sheetNote(
            $sheet,
            'Y',
            'Malaka darajasi/koeffitsienti hamda bayram, bir martalik, bo‘shash, kasallik, ta’til va moddiy yordam summalari tizimda qayd etilmagan; ular taxmin qilinmaydi va 0 yoki “Qayd etilmagan” deb ko‘rsatiladi.',
        );
        $headers = [
            '№', 'Tabel raqami', 'F.I.Sh.', 'Lavozimi', 'Tarif asosi',
            'Malaka darajasi', 'Malaka koeffitsienti', 'Norma ish kuni', 'Norma ish soati',
            'Haqiqiy ish kuni', 'Haqiqiy ish soati', 'Oylik tarif, so‘m',
            'Asosiy ish haqi', 'Mukofot, %', 'Mukofot, so‘m',
            'Harakat tig‘izligi, %', 'Harakat tig‘izligi to‘lovi',
            'Ko‘chib ishlash, %', 'Ko‘chib ishlash to‘lovi',
            'Bayram puli (qayd etilmagan)',
            'Bir martalik/bo‘shash/kasallik/ta’til/moddiy yordam (qayd etilmagan)',
            'Ish haqi jami', 'Ijtimoiy ajratma, %', 'Ijtimoiy ajratma', 'Jami, so‘m',
        ];
        $this->writeHeaders($sheet, 5, $headers);
        $row = 6;
        foreach ($this->laborSummaryRows($act['labor']) as $index => $line) {
            $this->writeRow($sheet, $row, [
                $index + 1,
                $line['personnelNumber'],
                $line['fullName'],
                $line['positionName'],
                $this->rateBasisLabel($line['rateBasis']),
                'Qayd etilmagan',
                'Qayd etilmagan',
                $line['normWorkingDays'],
                $line['normMinutes'] / 60,
                $line['actualDays'],
                $line['actualMinutes'] / 60,
                $line['unitRate'],
                $line['wageAmount'],
                $line['bonusRateBps'] / 100,
                $line['bonusAmount'],
                $line['trafficAllowanceRateBps'] / 100,
                $line['trafficAllowanceAmount'],
                $line['travelAllowanceRateBps'] / 100,
                $line['travelAllowanceAmount'],
                0,
                0,
                $line['wageAmount'] + $line['bonusAmount']
                    + $line['trafficAllowanceAmount'] + $line['travelAllowanceAmount'],
                $line['socialContributionRateBps'] / 100,
                $line['socialAmount'],
                $line['totalAmount'],
            ], [1, 2, 3, 4, 5, 6, 7]);
            $row++;
        }
        $sheet->mergeCells("A{$row}:I{$row}");
        $sheet->setCellValue("A{$row}", 'JAMI');
        foreach (['J', 'K', 'M', 'O', 'Q', 'S', 'T', 'U', 'V', 'X', 'Y'] as $column) {
            $this->setTotalFormula($sheet, $column, $row);
        }
        $sheet->getStyle("A{$row}:Y{$row}")->getFont()->setBold(true);
        $sheet->getStyle("A{$row}:Y{$row}")->getFill()
            ->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB(self::LIGHT_BLUE);
        $this->finishDetailSheet(
            $sheet,
            $row,
            [6, 16, 28, 22, 16, 16, 18, 14, 15, 14, 16, 18, 18, 13, 17, 15, 20, 15, 20, 18, 30, 18, 18, 20, 20],
            'H6:Y'.$row,
        );
    }

    /** @param array<string, mixed> $act */
    private function buildMaterialSheet(Worksheet $sheet, array $act): void
    {
        $sheet->setTitle('Materiallar');
        $this->sheetHeading($sheet, 'H', 'SARFLANGAN MATERIALLAR HISOBI', $act);
        $this->sheetNote($sheet, 'H', 'Jami = tasdiqlangan haqiqiy miqdor × muzlatilgan tasdiqlangan birlik narxi.');
        $headers = ['№', 'Topshiriq', 'Kod', 'Material nomi', 'Birlik', 'Miqdor', 'Birlik narxi, so‘m', 'Jami, so‘m'];
        $this->writeHeaders($sheet, 5, $headers);
        $row = 6;
        foreach ($act['materials'] as $index => $line) {
            $this->writeRow($sheet, $row, [
                $index + 1,
                $line['orderNumber'],
                $line['code'],
                $line['name'],
                $line['unit'],
                $line['quantity'],
                $line['unitPrice'],
                $line['amount'],
            ], [1, 2, 3, 4, 5]);
            $row++;
        }
        $this->appendTotal($sheet, $row, 8);
        $this->finishDetailSheet($sheet, $row, [6, 18, 16, 40, 12, 14, 20, 20], 'F6:H'.$row);
    }

    /** @param array<string, mixed> $act */
    private function buildTimesheetSheet(Worksheet $sheet, array $act): void
    {
        $sheet->setTitle('Tabel');
        $month = $this->monthStart((string) $act['period']);
        $daysInMonth = (int) $month->format('t');
        $firstDayColumnIndex = 5;
        $lastDayColumnIndex = $firstDayColumnIndex + $daysInMonth - 1;
        $lastDayColumn = Coordinate::stringFromColumnIndex($lastDayColumnIndex);
        $monthDaysColumn = Coordinate::stringFromColumnIndex($lastDayColumnIndex + 1);
        $monthHoursColumn = Coordinate::stringFromColumnIndex($lastDayColumnIndex + 2);
        $outsideHoursColumn = Coordinate::stringFromColumnIndex($lastDayColumnIndex + 3);
        $totalHoursColumn = Coordinate::stringFromColumnIndex($lastDayColumnIndex + 4);

        $this->sheetHeading($sheet, $totalHoursColumn, 'BAJARILGAN ISHLAR BO‘YICHA OYLIK TABEL', $act);
        $this->sheetNote(
            $sheet,
            $totalHoursColumn,
            'Kun kataklarida tasdiqlangan haqiqiy soat ko‘rsatiladi. Dalolatnoma oyidan tashqaridagi, lekin ishga bog‘langan muzlatilgan vaqt alohida ustunda saqlanadi.',
        );

        foreach (['A' => '№', 'B' => 'Tabel raqami', 'C' => 'F.I.Sh.', 'D' => 'Lavozimi'] as $column => $header) {
            $sheet->mergeCells("{$column}5:{$column}6");
            $this->setSafeText($sheet, "{$column}5", $header);
        }
        $sheet->mergeCells("E5:{$lastDayColumn}5");
        $this->setSafeText($sheet, 'E5', $act['period'].' kunlari');
        foreach (
            [
                $monthDaysColumn => 'Oy ish kuni',
                $monthHoursColumn => 'Oy ish soati',
                $outsideHoursColumn => 'Davrdan tashqari soat',
                $totalHoursColumn => 'Dalolatnoma jami soat',
            ] as $column => $header
        ) {
            $sheet->mergeCells("{$column}5:{$column}6");
            $this->setSafeText($sheet, "{$column}5", $header);
        }
        for ($day = 1; $day <= $daysInMonth; $day++) {
            $column = Coordinate::stringFromColumnIndex($firstDayColumnIndex + $day - 1);
            $sheet->setCellValueExplicit("{$column}6", $day, DataType::TYPE_NUMERIC);
        }
        $this->styleHeader($sheet, "A5:{$totalHoursColumn}6");

        $row = 7;
        foreach ($this->timesheetRows($act['labor'], (string) $act['period']) as $index => $line) {
            $this->writeRow($sheet, $row, [
                $index + 1,
                $line['personnelNumber'],
                $line['fullName'],
                $line['positionName'],
            ], [1, 2, 3, 4]);
            for ($day = 1; $day <= $daysInMonth; $day++) {
                $column = Coordinate::stringFromColumnIndex($firstDayColumnIndex + $day - 1);
                $minutes = $line['minutesByDay'][$day] ?? 0;
                if ($minutes > 0) {
                    $sheet->setCellValueExplicit("{$column}{$row}", $minutes / 60, DataType::TYPE_NUMERIC);
                }
            }
            $sheet->setCellValueExplicit("{$monthDaysColumn}{$row}", $line['monthWorkDays'], DataType::TYPE_NUMERIC);
            $sheet->setCellValueExplicit("{$monthHoursColumn}{$row}", $line['monthMinutes'] / 60, DataType::TYPE_NUMERIC);
            $sheet->setCellValueExplicit("{$outsideHoursColumn}{$row}", $line['outsideMinutes'] / 60, DataType::TYPE_NUMERIC);
            $sheet->setCellValueExplicit("{$totalHoursColumn}{$row}", $line['totalMinutes'] / 60, DataType::TYPE_NUMERIC);
            $row++;
        }

        $totalRow = $row;
        $sheet->mergeCells("A{$totalRow}:D{$totalRow}");
        $sheet->setCellValue("A{$totalRow}", 'JAMI');
        for ($columnIndex = $firstDayColumnIndex; $columnIndex <= $lastDayColumnIndex + 4; $columnIndex++) {
            $this->setTotalFormula($sheet, Coordinate::stringFromColumnIndex($columnIndex), $totalRow, 7);
        }
        $sheet->getStyle("A{$totalRow}:{$totalHoursColumn}{$totalRow}")->getFont()->setBold(true);
        $sheet->getStyle("A{$totalRow}:{$totalHoursColumn}{$totalRow}")->getFill()
            ->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB(self::LIGHT_BLUE);

        $this->styleBody($sheet, "A5:{$totalHoursColumn}{$totalRow}");
        $sheet->getStyle("E7:{$totalHoursColumn}{$totalRow}")->getNumberFormat()->setFormatCode('0.00');
        $this->setWidths($sheet, [6, 16, 30, 22]);
        for ($columnIndex = $firstDayColumnIndex; $columnIndex <= $lastDayColumnIndex; $columnIndex++) {
            $column = Coordinate::stringFromColumnIndex($columnIndex);
            $sheet->getColumnDimension($column)->setWidth(5);
            $day = $columnIndex - $firstDayColumnIndex + 1;
            if ((int) $month->setDate((int) $month->format('Y'), (int) $month->format('m'), $day)->format('N') >= 6
                && $totalRow > 7) {
                $sheet->getStyle("{$column}7:{$column}".($totalRow - 1))->getFill()
                    ->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB(self::LIGHT_GRAY);
            }
        }
        foreach ([$monthDaysColumn, $monthHoursColumn, $outsideHoursColumn, $totalHoursColumn] as $column) {
            $sheet->getColumnDimension($column)->setWidth(16);
        }
        $sheet->freezePane('E7');
        $this->printLandscape($sheet, "A1:{$totalHoursColumn}{$totalRow}");
    }

    /** @param array<string, mixed> $act */
    private function buildEquipmentSheet(Worksheet $sheet, array $act): void
    {
        $sheet->setTitle('Mashina-mexanizm');
        $this->sheetHeading($sheet, 'G', 'MASHINA VA MEXANIZMLAR MASHINA-SOATI HISOBI', $act);
        $this->sheetNote($sheet, 'G', 'Jami = tasdiqlangan haqiqiy mashina-daqiqa / 60 × muzlatilgan tasdiqlangan mashina-soat narxi.');
        $headers = ['№', 'Topshiriq', 'Inventar kodi', 'Mashina/mexanizm', 'Mashina-soat', '1 mashina-soat narxi', 'Jami, so‘m'];
        $this->writeHeaders($sheet, 5, $headers);
        $row = 6;
        foreach ($act['equipment'] as $index => $line) {
            $this->writeRow($sheet, $row, [
                $index + 1,
                $line['orderNumber'],
                $line['inventoryCode'],
                $line['name'],
                $line['machineMinutes'] / 60,
                $line['machineHourRate'],
                $line['amount'],
            ], [1, 2, 3, 4]);
            $row++;
        }
        $this->appendTotal($sheet, $row, 7);
        $this->finishDetailSheet($sheet, $row, [6, 18, 18, 42, 16, 22, 20], 'E6:G'.$row);
    }

    /** @param array<string, mixed> $act */
    private function buildSummarySheet(Worksheet $sheet, array $act): void
    {
        $sheet->setTitle('Umumiy xarajat');
        $this->sheetHeading($sheet, 'D', 'OYLIK BAJARILGAN ISHLAR QIYMATI', $act);
        $this->sheetNote(
            $sheet,
            'D',
            'Transport, boshqa xarajat va QQS uchun alohida tasdiqlangan manba sxemasi yo‘q; ular taxmin qilinmaydi va 0 ko‘rsatiladi.',
        );
        $rows = [
            ['Ish haqi', $act['totals']['labor']],
            ['Ijtimoiy ajratmalar', $act['totals']['social']],
            ['Materiallar, jihozlar va SHHV', $act['totals']['materials']],
            ['Mashina va mexanizmlar', $act['totals']['equipment']],
            ['Transport (alohida manba qayd etilmagan)', $act['totals']['transport']],
            ['Boshqa xarajatlar (qayd etilmagan)', $act['totals']['other']],
            ['Jami (QQSsiz)', $act['totals']['subtotal']],
            ['QQS (qayd etilmagan)', $act['totals']['vat']],
            ['JAMI TO‘LOV', $act['totals']['grandTotal']],
        ];
        $this->writeHeaders($sheet, 5, ['№', 'Xarajat turi', 'Valyuta', 'Summa']);
        foreach ($rows as $index => [$label, $amount]) {
            $this->writeRow($sheet, 6 + $index, [$index + 1, $label, 'UZS', $amount], [1, 2, 3]);
        }
        $last = 5 + count($rows);
        $sheet->getStyle("A{$last}:D{$last}")->getFont()->setBold(true);
        $sheet->getStyle("A{$last}:D{$last}")->getFill()
            ->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB(self::LIGHT_BLUE);
        $this->finishDetailSheet($sheet, $last, [6, 42, 12, 24], 'D6:D'.$last);
    }

    /** @param array<string, mixed> $act */
    private function sheetHeading(Worksheet $sheet, string $lastColumn, string $title, array $act): void
    {
        $sheet->mergeCells("A1:{$lastColumn}1");
        $this->setSafeText($sheet, 'A1', $title);
        $sheet->mergeCells("A2:{$lastColumn}2");
        $this->setSafeText($sheet, 'A2', $act['divisionName'].' · '.$act['roadLabel'].' · '.$act['period']);
        $sheet->mergeCells("A3:{$lastColumn}3");
        $this->setSafeText($sheet, 'A3', 'Dalolatnoma № '.$act['actNumber'].' · Holat: '.$act['state']);
        $this->styleTitle($sheet, "A1:{$lastColumn}1");
        $this->styleSubtitle($sheet, "A2:{$lastColumn}3");
    }

    private function sheetNote(Worksheet $sheet, string $lastColumn, string $note): void
    {
        $sheet->mergeCells("A4:{$lastColumn}4");
        $this->setSafeText($sheet, 'A4', $note);
        $sheet->getStyle("A4:{$lastColumn}4")->getFont()->setItalic(true)->setSize(9)
            ->getColor()->setARGB(self::NAVY);
        $sheet->getStyle("A4:{$lastColumn}4")->getAlignment()
            ->setHorizontal(Alignment::HORIZONTAL_LEFT)
            ->setVertical(Alignment::VERTICAL_CENTER)
            ->setWrapText(true);
        $sheet->getRowDimension(4)->setRowHeight(30);
    }

    /** @param list<string> $headers */
    private function writeHeaders(Worksheet $sheet, int $row, array $headers): void
    {
        foreach ($headers as $index => $header) {
            $this->setSafeText($sheet, Coordinate::stringFromColumnIndex($index + 1).$row, $header);
        }
        $lastColumn = Coordinate::stringFromColumnIndex(count($headers));
        $this->styleHeader($sheet, "A{$row}:{$lastColumn}{$row}");
    }

    /**
     * @param  list<int|float|string|null>  $values
     * @param  list<int>  $textColumns
     */
    private function writeRow(Worksheet $sheet, int $row, array $values, array $textColumns): void
    {
        foreach ($values as $index => $value) {
            $column = $index + 1;
            $cell = Coordinate::stringFromColumnIndex($column).$row;
            if ($value === null) {
                continue;
            }
            if (in_array($column, $textColumns, true)) {
                $this->setSafeText($sheet, $cell, (string) $value);
            } else {
                $sheet->setCellValueExplicit($cell, (float) $value, DataType::TYPE_NUMERIC);
            }
        }
    }

    private function appendTotal(Worksheet $sheet, int $row, int $lastColumnIndex): void
    {
        $lastColumn = Coordinate::stringFromColumnIndex($lastColumnIndex);
        $sheet->mergeCells("A{$row}:".Coordinate::stringFromColumnIndex($lastColumnIndex - 1).$row);
        $sheet->setCellValue("A{$row}", 'JAMI');
        $this->setTotalFormula($sheet, $lastColumn, $row);
        $sheet->getStyle("A{$row}:{$lastColumn}{$row}")->getFont()->setBold(true);
        $sheet->getStyle("A{$row}:{$lastColumn}{$row}")->getFill()
            ->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB(self::LIGHT_BLUE);
    }

    private function setTotalFormula(Worksheet $sheet, string $column, int $row, int $firstDataRow = 6): void
    {
        if ($row === $firstDataRow) {
            $sheet->setCellValueExplicit("{$column}{$row}", 0.0, DataType::TYPE_NUMERIC);

            return;
        }
        $sheet->setCellValue(
            "{$column}{$row}",
            "=SUM({$column}{$firstDataRow}:{$column}".($row - 1).')',
        );
    }

    /** @param list<int> $widths */
    private function finishDetailSheet(
        Worksheet $sheet,
        int $lastRow,
        array $widths,
        string $numberRange,
    ): void {
        $lastColumn = Coordinate::stringFromColumnIndex(count($widths));
        $this->styleBody($sheet, "A5:{$lastColumn}{$lastRow}");
        $sheet->getStyle($numberRange)->getNumberFormat()->setFormatCode('#,##0.00');
        $this->setWidths($sheet, $widths);
        $sheet->freezePane('A6');
        $sheet->setAutoFilter("A5:{$lastColumn}".max(5, $lastRow - 1));
        $this->printLandscape($sheet, "A1:{$lastColumn}{$lastRow}");
    }

    private function setSafeText(Worksheet $sheet, string $cell, string $value): void
    {
        $sheet->setCellValueExplicit($cell, $value, DataType::TYPE_STRING);
    }

    private function styleTitle(Worksheet $sheet, string $range): void
    {
        $sheet->getStyle($range)->getFont()->setBold(true)->setSize(16)->getColor()->setARGB(self::WHITE);
        $sheet->getStyle($range)->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB(self::NAVY);
        $sheet->getStyle($range)->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
        $sheet->getRowDimension(1)->setRowHeight(28);
    }

    private function styleSubtitle(Worksheet $sheet, string $range): void
    {
        $sheet->getStyle($range)->getFont()->setSize(10)->getColor()->setARGB(self::NAVY);
        $sheet->getStyle($range)->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
    }

    private function styleHeader(Worksheet $sheet, string $range): void
    {
        $style = $sheet->getStyle($range);
        $style->getFont()->setBold(true)->getColor()->setARGB(self::WHITE);
        $style->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setARGB(self::BLUE);
        $style->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER)
            ->setVertical(Alignment::VERTICAL_CENTER)->setWrapText(true);
    }

    private function styleBody(Worksheet $sheet, string $range): void
    {
        $style = $sheet->getStyle($range);
        $style->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN)->getColor()->setARGB('FFCDD7DE');
        $style->getAlignment()->setVertical(Alignment::VERTICAL_CENTER)->setWrapText(true);
    }

    /** @param list<int> $widths */
    private function setWidths(Worksheet $sheet, array $widths): void
    {
        foreach ($widths as $index => $width) {
            $sheet->getColumnDimension(Coordinate::stringFromColumnIndex($index + 1))->setWidth($width);
        }
    }

    private function printLandscape(Worksheet $sheet, string $printArea): void
    {
        $sheet->getPageSetup()
            ->setOrientation(PageSetup::ORIENTATION_LANDSCAPE)
            ->setPaperSize(PageSetup::PAPERSIZE_A4)
            ->setFitToWidth(1)
            ->setFitToHeight(0)
            ->setPrintArea($printArea);
        $sheet->getPageMargins()->setTop(0.4)->setRight(0.3)->setBottom(0.4)->setLeft(0.3);
    }

    /**
     * @param  list<array<string, mixed>>  $labor
     * @return list<array<string, mixed>>
     */
    private function laborSummaryRows(array $labor): array
    {
        $rows = [];
        foreach ($labor as $line) {
            $key = implode("\x1F", array_map(
                static fn ($value): string => (string) $value,
                [
                    $line['personnelNumber'], $line['fullName'], $line['positionName'],
                    $line['rateBasis'], $line['unitRate'], $line['normWorkingDays'],
                    $line['normMinutes'], $line['bonusRateBps'], $line['trafficAllowanceRateBps'],
                    $line['travelAllowanceRateBps'], $line['socialContributionRateBps'],
                ],
            ));
            if (! isset($rows[$key])) {
                $rows[$key] = [
                    'personnelNumber' => (string) $line['personnelNumber'],
                    'fullName' => (string) $line['fullName'],
                    'positionName' => (string) $line['positionName'],
                    'rateBasis' => (string) $line['rateBasis'],
                    'unitRate' => (float) $line['unitRate'],
                    'normWorkingDays' => (int) $line['normWorkingDays'],
                    'normMinutes' => (int) $line['normMinutes'],
                    'bonusRateBps' => (int) $line['bonusRateBps'],
                    'trafficAllowanceRateBps' => (int) $line['trafficAllowanceRateBps'],
                    'travelAllowanceRateBps' => (int) $line['travelAllowanceRateBps'],
                    'socialContributionRateBps' => (int) $line['socialContributionRateBps'],
                    'actualMinutes' => 0,
                    'workDates' => [],
                    'wageAmount' => 0.0,
                    'bonusAmount' => 0.0,
                    'trafficAllowanceAmount' => 0.0,
                    'travelAllowanceAmount' => 0.0,
                    'socialAmount' => 0.0,
                    'totalAmount' => 0.0,
                ];
            }
            $rows[$key]['actualMinutes'] += (int) $line['actualMinutes'];
            $rows[$key]['workDates'][(string) $line['workDate']] = true;
            foreach (
                [
                    'wageAmount', 'bonusAmount', 'trafficAllowanceAmount',
                    'travelAllowanceAmount', 'socialAmount', 'totalAmount',
                ] as $amount
            ) {
                $rows[$key][$amount] += (float) $line[$amount];
            }
        }

        return array_values(array_map(static function (array $row): array {
            $row['actualDays'] = count($row['workDates']);
            unset($row['workDates']);

            return $row;
        }, $rows));
    }

    /**
     * @param  list<array<string, mixed>>  $labor
     * @return list<array<string, mixed>>
     */
    private function timesheetRows(array $labor, string $period): array
    {
        $this->monthStart($period);
        $rows = [];
        foreach ($labor as $line) {
            $workDate = \DateTimeImmutable::createFromFormat('!Y-m-d', (string) $line['workDate']);
            if ($workDate === false || $workDate->format('Y-m-d') !== (string) $line['workDate']) {
                throw new \InvalidArgumentException('Labor work date must use Y-m-d format.');
            }
            $key = implode("\x1F", [
                (string) $line['personnelNumber'],
                (string) $line['fullName'],
                (string) $line['positionName'],
            ]);
            if (! isset($rows[$key])) {
                $rows[$key] = [
                    'personnelNumber' => (string) $line['personnelNumber'],
                    'fullName' => (string) $line['fullName'],
                    'positionName' => (string) $line['positionName'],
                    'minutesByDay' => [],
                    'outsideMinutes' => 0,
                    'totalMinutes' => 0,
                ];
            }
            $minutes = (int) $line['actualMinutes'];
            if ($workDate->format('Y-m') === $period) {
                $day = (int) $workDate->format('j');
                $rows[$key]['minutesByDay'][$day] = ($rows[$key]['minutesByDay'][$day] ?? 0) + $minutes;
            } else {
                $rows[$key]['outsideMinutes'] += $minutes;
            }
            $rows[$key]['totalMinutes'] += $minutes;
        }

        return array_values(array_map(static function (array $row): array {
            ksort($row['minutesByDay']);
            $row['monthWorkDays'] = count($row['minutesByDay']);
            $row['monthMinutes'] = array_sum($row['minutesByDay']);

            return $row;
        }, $rows));
    }

    private function monthStart(string $period): \DateTimeImmutable
    {
        $month = \DateTimeImmutable::createFromFormat('!Y-m', $period);
        if ($month === false || $month->format('Y-m') !== $period) {
            throw new \InvalidArgumentException('Monthly completion act period must use Y-m format.');
        }

        return $month;
    }

    private function rateBasisLabel(string $basis): string
    {
        return match ($basis) {
            'monthly_salary' => 'Oylik tarif',
            default => $basis,
        };
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @return list<array<string, mixed>>
     */
    private function aggregatedActItems(array $items): array
    {
        $groups = [];
        foreach ($items as $item) {
            $key = (string) ($item['aggregationKey'] ?? 'order:'.$item['orderNumber']);
            $ytdKey = (string) ($item['ytdGroupKey'] ?? 'order:'.$item['orderNumber']);
            if (! isset($groups[$key])) {
                $groups[$key] = $item;
                $groups[$key]['iqnTotalLaborMinutes'] = isset($item['iqnTotalLaborMinutes'])
                    ? (float) $item['iqnTotalLaborMinutes']
                    : null;
                $groups[$key]['orderNumbers'] = [(string) $item['orderNumber']];
                $groups[$key]['_normReferences'] = [(string) $item['normReference'] => true];
                $groups[$key]['_ytdGroups'] = [
                    $ytdKey => [
                        'annualPlannedQuantity' => (float) $item['annualPlannedQuantity'],
                        'yearToDateQuantity' => (float) $item['yearToDateQuantity'],
                        'yearToDateAmount' => (float) $item['yearToDateAmount'],
                    ],
                ];

                continue;
            }

            $groups[$key]['orderNumbers'][] = (string) $item['orderNumber'];
            foreach (['monthQuantity', 'monthAmount'] as $field) {
                $groups[$key][$field] = (float) $groups[$key][$field] + (float) $item[$field];
            }
            if ($groups[$key]['iqnTotalLaborMinutes'] === null
                || ($item['iqnTotalLaborMinutes'] ?? null) === null) {
                $groups[$key]['iqnTotalLaborMinutes'] = null;
            } else {
                $groups[$key]['iqnTotalLaborMinutes'] =
                    (float) $groups[$key]['iqnTotalLaborMinutes']
                    + (float) $item['iqnTotalLaborMinutes'];
            }
            if (! isset($groups[$key]['_ytdGroups'][$ytdKey])) {
                $groups[$key]['_ytdGroups'][$ytdKey] = [
                    'annualPlannedQuantity' => 0.0,
                    'yearToDateQuantity' => 0.0,
                    'yearToDateAmount' => 0.0,
                ];
            }
            foreach (['annualPlannedQuantity', 'yearToDateQuantity', 'yearToDateAmount'] as $field) {
                $groups[$key]['_ytdGroups'][$ytdKey][$field] = max(
                    (float) $groups[$key]['_ytdGroups'][$ytdKey][$field],
                    (float) $item[$field],
                );
            }
            $groups[$key]['_normReferences'][(string) $item['normReference']] = true;
        }

        foreach ($groups as $key => &$group) {
            $group['orderNumbers'] = array_values(array_unique($group['orderNumbers']));
            sort($group['orderNumbers'], SORT_NATURAL);
            $group['orderNumber'] = implode(', ', $group['orderNumbers']);
            $group['normReference'] = implode('; ', array_keys($group['_normReferences']));
            foreach (['annualPlannedQuantity', 'yearToDateQuantity', 'yearToDateAmount'] as $field) {
                $group[$field] = array_sum(array_column($group['_ytdGroups'], $field));
            }
            $group['ytdGroupKey'] = count($group['_ytdGroups']) === 1
                ? (string) array_key_first($group['_ytdGroups'])
                : 'aggregate:'.$key;
            $group['iqnUnitLaborMinutes'] = $group['iqnTotalLaborMinutes'] === null
                ? null
                : ((float) $group['monthQuantity'] > 0
                    ? (float) $group['iqnTotalLaborMinutes'] / (float) $group['monthQuantity']
                    : 0.0);
            unset($group['_normReferences'], $group['_ytdGroups']);
        }
        unset($group);

        return array_values($groups);
    }

    /**
     * @param  array<string, mixed>  $act
     * @param  list<string>  $orderNumbers
     * @return array{labor:float,social:float,materials:float,equipment:float,laborMinutes:int}
     */
    private function itemCostShare(array $act, array $orderNumbers): array
    {
        $share = [
            'labor' => 0.0,
            'social' => 0.0,
            'materials' => 0.0,
            'equipment' => 0.0,
            'laborMinutes' => 0,
        ];
        foreach ($act['labor'] as $line) {
            if (in_array($line['orderNumber'] ?? null, $orderNumbers, true)) {
                $share['labor'] += (float) $line['wageAmount']
                    + (float) $line['bonusAmount']
                    + (float) $line['trafficAllowanceAmount']
                    + (float) $line['travelAllowanceAmount'];
                $share['social'] += (float) $line['socialAmount'];
                $share['laborMinutes'] += (int) $line['actualMinutes'];
            }
        }
        foreach ($act['materials'] as $line) {
            if (in_array($line['orderNumber'] ?? null, $orderNumbers, true)) {
                $share['materials'] += (float) $line['amount'];
            }
        }
        foreach ($act['equipment'] as $line) {
            if (in_array($line['orderNumber'] ?? null, $orderNumbers, true)) {
                $share['equipment'] += (float) $line['amount'];
            }
        }

        return $share;
    }
}
