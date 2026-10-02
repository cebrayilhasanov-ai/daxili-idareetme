"use client";

// Təlimatlar (Versiya 2.78; Tapşırıqlar və Sorğular — 2.79): how each section works, written into the program. A guide is shown only to those who may open its
// section, and each of its parts only to the audience it is for (everyone, the registrar, department heads, the director, the admin).
// The texts follow what the code does; when a section's rules change, its guide here changes with it.

import { Fragment, useEffect, useState } from "react";
import { Printer, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Audience = "all" | "registrar" | "head" | "director" | "admin";
type Block = { p: string } | { steps: string[] } | { list: string[] } | { note: string } | { qa: [string, string][] };
type GuidePart = { audience: Audience; title: string; blocks: Block[] };
type Guide = { id: string; group: string; title: string; path: string; section: string; registrarKey?: string; intro: string; parts: GuidePart[] };

export type GuideContext = {
  isAdmin: boolean;
  // Sections the viewer may open (the same rule as the menu).
  sections: Record<string, boolean>;
  // Section permissions themselves (the registrar of incoming / outgoing documents).
  rights: Record<string, boolean>;
  // The employee the admin is viewing as (İstifadəçi görünüşü), whose head/director roles are asked for.
  viewEmployeeId?: number | null;
};

const AUDIENCE_LABELS: Record<Audience, string> = { all: "Hamı üçün", registrar: "Qeydiyyatçı üçün", head: "Şöbə rəhbəri üçün", director: "Firmanın rəhbəri (direktor) üçün", admin: "Admin üçün" };

const GUIDES: Guide[] = [
  {
    id: "tasks", group: "Tapşırıqlar", title: "Verilən tapşırıqlar", path: "Tapşırıqlar → Verilən tapşırıqlar", section: "tasks.manager",
    intro: "Sizə verilmiş tapşırıqlar: admin tərəfindən verilənlər, rəhbərin daxil olan sənəd üzrə dərkənarı, rəhbərinizin sizə həvalə etdiyi iş addımları və qəbul edilmiş sorğular. Hər tapşırığın son tarixi, icra ardıcıllığı və qiyməti var.",
    parts: [
      { audience: "all", title: "Statuslar və icra ardıcıllığı", blocks: [
        { steps: [
          "Yeni — tapşırıq sizə düşüb. İşə başlayanda “İcraya al” basın → İcradadır.",
          "İş bitəndə “Təqdim et” basın → Təqdim edilib. Tapşırıqla doldurulmalı fayl göndərilibsə, işlənmiş faylı yükləmədən təqdim etmək olmur.",
          "Yoxlayan işi qəbul edirsə, 1–10 bal verir → Təsdiqlənib. Qəbul etmirsə, səbəbini yazıb geri qaytarır → Geri qaytarılıb; düzəldib yenidən “Təqdim et” basırsınız.",
        ] },
        { note: "Status yalnız bu ardıcıllıqla dəyişir; təqdim edilmiş tapşırığı geri çəkmək olmur. Son tarixi keçmiş aktiv tapşırıq gecikən sayılır və zəngdə (🔔) göstərilir." },
      ] },
      { audience: "all", title: "Son tarixin dəyişdirilməsi", blocks: [
        { list: [
          "Tapşırığı vaxtında bitirə bilməyəcəksinizsə, tapşırıqdan yeni tarix və səbəb yazaraq tarix dəyişikliyi istəyin.",
          "Hər tapşırıq üçün bunu yalnız bir dəfə və təqdim etməzdən əvvəl etmək olar.",
          "Admin tələbi qəbul edir (öz tarixini də yaza bilər) və ya rədd edir. İlkin tarix tapşırıqda “ilkin tarix” kimi qalır.",
        ] },
      ] },
      { audience: "all", title: "İş addımları və həvalə", blocks: [
        { list: [
          "Tapşırığın içində iş addımları yazıb hər birini ✓ edə, addıma fayl əlavə edə bilərsiniz.",
          "Rəhbərsinizsə, addımın yanında tabeliyinizdəki əməkdaşı seçib “Ver” basa bilərsiniz (həvalə) — o addım həmin əməkdaşa ayrıca tapşırıq kimi düşür (addımın faylı ilə). Kimə həvalə etmək olar — firmanın strukturu göstərir; boş vəzifə atlanır və onun tabeliyindəkilər təklif olunur.",
          "Həvalə üçün tapşırığın firması təyin olunmalıdır.",
          "Həvalə edilmiş addımın ✓-u əl ilə qoyulmur — əməkdaşın tapşırığı təsdiqlənəndə avtomatik qoyulur. Əsas sütunda həvalə zənciri (kim kimə verib) görünür.",
        ] },
      ] },
      { audience: "all", title: "Sorğudan yaranan tapşırıq", blocks: [
        { p: "Şöbə rəhbəri gələn sorğunu sizə verəndə o, burada “Sorğu əsasında” tapşırıq kimi görünür. Təqdim edərkən yazdığınız cavab mətni və fayl sorğunu göndərənə gedir. Belə tapşırığı sorğunu göndərən cavabı təsdiqləyəndən sonra şöbə rəhbəri Sorğular bölməsində qiymətləndirir." },
      ] },
      { audience: "admin", title: "Tapşırıq vermək və yoxlamaq", blocks: [
        { list: [
          "Yeni tapşırığı admin verir: icraçı, firma (icraçının firmalarından), adı, açıqlaması, son tarixi, istəyə görə doldurulacaq fayl.",
          "Təqdim edilmiş tapşırığı “Qiymətləndir” ilə 1–10 balla təsdiqləyin və ya səbəb yazıb geri qaytarın.",
          "Tarix dəyişikliyi tələblərini qəbul və ya rədd edin.",
          "Yalnız “Yeni” statuslu tapşırıq silinir. Sorğudan yaranan tapşırıq silinmir — onu Sorğular bölməsindən (icraçını dəyişmək, imtina) idarə edin.",
        ] },
      ] },
    ],
  },
  {
    id: "personal", group: "Tapşırıqlar", title: "Şəxsi işlərim", path: "Tapşırıqlar → Şəxsi işlərim", section: "tasks.mine",
    intro: "Özünüz üçün yazdığınız işlər və onların iş axını (addımlar). Addımı tabeliyinizdəki əməkdaşa həvalə edə və ya başqa şöbəyə sorğu kimi göndərə bilərsiniz. İşləri yalnız siz (və admin) görürsünüz.",
    parts: [
      { audience: "all", title: "İşin gedişi", blocks: [
        { steps: [
          "“Əlavə et”: işin adı, açıqlaması, firması, son tarixi (istəyə bağlı), fayl.",
          "İş axınına addımlar əlavə edin.",
          "İşə başlayanda “İcraya al” → İcradadır. Addımlar yalnız icradakı işdə ✓ edilir.",
          "Bütün addımlar ✓ olanda iş avtomatik “Tamamlanıb” olur. Addımı olmayan işi “Tamamla” ilə bitirirsiniz.",
        ] },
        { list: [
          "Yalnız “Yeni” statuslu iş silinir; tamamlanmış iş redaktə olunmur və ona addım əlavə olunmur.",
          "“Aç” pəncərəsində işin tarixçəsi var: yaradılma, addımlar, həvalələr, sorğular, təsdiqlər.",
        ] },
      ] },
      { audience: "all", title: "Addımı başqasına vermək", blocks: [
        { list: [
          "Həvalə: addımın yanında tabeliyinizdəki əməkdaşı seçib “Ver” basın — addım ona tapşırıq kimi düşür (Verilən tapşırıqlar). Tapşırıq təsdiqlənəndə addımın ✓-u avtomatik qoyulur.",
          "“Şöbəyə sorğu” — addım işin firmasının başqa şöbəsinə sorğu kimi gedir (Sorğular). İş icrada olmalı və firması seçilməlidir. Addımın faylı sorğuya da gedir.",
          "Sorğu açıq olduğu müddətdə addımı silmək, həvalə etmək və ya yenidən göndərmək olmur. Cavabı təsdiqləyəndə addımın ✓-u avtomatik qoyulur.",
        ] },
      ] },
    ],
  },
  {
    id: "requests", group: "Tapşırıqlar", title: "Sorğular", path: "Tapşırıqlar → Sorğular", section: "tasks.requests",
    intro: "Şöbələrarası iş tələbləri və məlumat sorğuları (məsələn, Təchizat → Mühasibatlıq). Tapşırıq yuxarıdan aşağı verilir, sorğu isə eyni firmanın başqa şöbəsinə gedir: o şöbənin rəhbəri qəbul edib icraçı seçir, icraçı cavablandırır, göndərən cavabı təsdiqləyir.",
    parts: [
      { audience: "all", title: "Statuslar", blocks: [
        { list: [
          "Yeni — göndərilib, şöbə rəhbəri hələ baxmayıb.",
          "Qəbul edildi — rəhbər icraçı və razılaşdırılmış tarix təyin edib; icraçıya tapşırıq düşüb.",
          "İcra olunur — icraçı işə başlayıb.",
          "Cavablandı — icraçı cavab verib; göndərənin təsdiqi gözlənilir.",
          "Qiymətləndirmə gözləyir — göndərən cavabı təsdiqləyib; şöbə rəhbəri icraçının işinə bal verməlidir.",
          "Bağlandı / İmtina edildi.",
        ] },
        { p: "Tablar: “Gələnlər” (şöbənizə gələnlər və sizə verilənlər), “Göndərdiklərim”, rəhbər üçün “Şöbəmin sorğuları” (şöbənizdən başqa şöbələrə gedənlər). Sizdən əməliyyat gözləyən sorğular sayğacla göstərilir." },
      ] },
      { audience: "all", title: "Sorğu göndərmək və cavabı qəbul etmək", blocks: [
        { steps: [
          "“Yeni sorğu”: firmanı, şöbəni, mövzunu, təsviri, istədiyiniz tarixi yazın, lazım olsa fayl əlavə edin, “Göndər”.",
          "Hələ “Yeni” ikən sorğunu silə (geri çağıra) bilərsiniz.",
          "Cavab gələndə (Cavablandı) ya “Cavabı təsdiqlə ✓”, ya da nəyin çatışmadığını yazıb “Yenidən aç” — iş icraçıya geri qayıdır.",
          "Sorğu bağlanana qədər hər iki tərəf şərh yaza bilər.",
        ] },
        { note: "İcraçıya verilən bal şöbənin daxili məsələsidir — sorğunu göndərən tərəf onu görmür." },
      ] },
      { audience: "all", title: "İcraçı üçün", blocks: [
        { p: "Qəbul edilmiş sorğu sizə tapşırıq kimi düşür (Verilən tapşırıqlar, “Sorğu əsasında”). “İcraya al”, sonra “Təqdim et” — cavab mətni və faylı sorğunu göndərənə gedir. Sorğu yenidən açılarsa, tapşırıq “Geri qaytarılıb” olur." },
      ] },
      { audience: "head", title: "Şöbə rəhbəri üçün", blocks: [
        { list: [
          "Gələn sorğunu “Qəbul et”: icraçını şöbənizin əməkdaşlarından seçin və razılaşdırılmış tarixi yazın. Və ya səbəbini yazaraq “İmtina et”.",
          "İcra gedərkən “İcraçını dəyiş” — köhnə icraçının tapşırığı götürülür, yenisinə yeni tapşırıq düşür.",
          "Göndərən cavabı təsdiqləyəndən sonra “Qiymətləndir”: 1–10 bal və istəyə görə rəy — sorğu bağlanır, icraçının tapşırığı təsdiqlənir.",
        ] },
      ] },
      { audience: "admin", title: "Admin üçün", blocks: [
        { p: "Admin bütün sorğuları görür və istənilən mərhələdə rəhbərin əvəzinə hərəkət edə bilər. Rəhbəri təyin olunmamış şöbəyə gələn sorğular yalnız adminə düşür. Sorğular firmanın strukturundakı şöbələrə gedir — struktur boşdursa, sorğu göndərmək olmur." },
      ] },
    ],
  },
  {
    id: "fixed", group: "Tapşırıqlar", title: "Sabit işlər (aylıq və həftəlik)", path: "Tapşırıqlar → Aylıq sabit işlər / Həftəlik sabit işlər", section: "tasks.fixed",
    intro: "Sabit işlər hər ay və ya hər həftə təkrarlanan, konkret işçiyə həvalə edilmiş işlərdir (məsələn, aylıq hesabat, həftəlik yoxlama). Hər dövr üçün işçi işin icrasını cədvəldə ✓ ilə qeyd edir.",
    parts: [
      { audience: "all", title: "Dövrlər və son tarixlər", blocks: [
        { list: [
          "Aylıq iş ay bitəndən sonra açılır və növbəti ayın göstərilən gününədək icra olunmalıdır. Standart son gün — 10-u. Məsələn: yanvarın işi 1 fevralda açılır, son tarix 10 fevral (günün sonuna qədər).",
          "Göstərilən gün ayda yoxdursa (məs. 31-i), son tarix ayın son gününə düşür.",
          "Həftəlik iş həftənin bazar ertəsi açılır, son tarix həmin həftənin göstərilən günüdür. Standart — cümə.",
          "Bütün vaxtlar Bakı vaxtı ilə hesablanır.",
        ] },
      ] },
      { audience: "all", title: "İşin icrasını necə qeyd etməli", blocks: [
        { steps: [
          "Tapşırıqlar → Aylıq sabit işlər (və ya Həftəlik sabit işlər) bölməsini açın.",
          "“Mənim sabit işlərim” cədvəlində ili seçin. Hər sətir bir işdir, sütunlar aylardır (həftəlik işlərdə — həftələr).",
          "İcra etdiyiniz dövrün xanasına basın və “icra edildi kimi işarələnsin?” sualını təsdiqləyin.",
        ] },
        { p: "Xananın rəngi dövrün vəziyyətini göstərir:" },
        { list: ["Hələ açılmayıb — bu dövrə hələ ✓ qoymaq olmur.", "Açıqdır — icra etmək vaxtıdır.", "Vaxtında icra edilib.", "Gecikməklə icra edilib — ✓ son tarixdən sonra qoyulub."] },
        { note: "Qoyulan ✓ geri götürülmür. Onu yalnız iş həqiqətən icra olunanda qoyun." },
        { note: "Bir neçə firmada işləyirsinizsə, cədvəl soldakı “Aktiv firma” seçiminə görə göstərilir; eyni iş hər firma üzrə ayrıca sətirdir." },
      ] },
      { audience: "all", title: "Tez-tez verilən suallar", blocks: [
        { qa: [
          ["Son tarix keçib, yenə ✓ qoya bilərəmmi?", "Bəli. Dövr açıqdırsa, istənilən vaxt qoymaq olar, amma iş “Gecikməklə icra edilib” kimi qalır."],
          ["Xanaya basa bilmirəm.", "Dövr hələ açılmayıb (məs. cari ayın aylıq işi yalnız növbəti ayın 1-də açılır) və ya Giriş icazələrində bu bölmə sizin üçün bağlıdır."],
          ["Mənə yeni iş lazımdır və ya iş başqasına keçməlidir.", "Sabit işləri yalnız admin yaradır və təyin edir — ona müraciət edin."],
        ] },
      ] },
      { audience: "admin", title: "Sabit işin yaradılması və təyini", blocks: [
        { steps: [
          "“Sabit işlərin siyahısı” tabında işin adını və açıqlamasını yazıb “Siyahıya əlavə et” basın.",
          "Sətirdə son tarix gününü seçin (aylıq: növbəti ayın günü, həftəlik: həftənin günü). Seçilməsə, standart işləyir — 10-u / cümə.",
          "İşin aid olduğu firmaları işarələyin və hər firma üçün icra edəcək istifadəçini seçin. Bir firmada bir iş yalnız bir nəfərə təyin olunur.",
          "“Personal sabit işlər” tabında işlərin personal və firmalar üzrə bölgüsünə baxın; buradan da bir işi seçib istifadəçiyə bir neçə firma üzrə birdən təyin etmək olar.",
        ] },
        { note: "İstifadəçidə “Aylıq/Həftəlik sabit işlər” icazəsi bağlıdırsa, o, təyin edilmiş işlərə ✓ qoya bilməz — Giriş icazələrində bu barədə xəbərdarlıq çıxır." },
      ] },
    ],
  },
  {
    id: "incoming", group: "Sənədlər", title: "Daxil olan sənədlər", path: "Sənədlər → Daxil olan sənədlər", section: "documents.incoming", registrarKey: "documents.incoming",
    intro: "Firmaya kənardan gələn sənədlərin qeydiyyatı, rəhbərin baxışı və dərkənarı, şöbələrin icrası və iki səviyyəli təsdiq. Hər firmanın öz Daxil olma No ardıcıllığı var.",
    parts: [
      { audience: "all", title: "Sənədi kim görür (kommersiya sirri)", blocks: [
        { list: [
          "Admin və firmanın rəhbəri (direktor) — firmanın bütün sənədlərini.",
          "Qeydiyyatçı (Giriş icazələrində “Daxil olan sənədlər” icazəsi olan) — öz firmalarının sənədlərini.",
          "Aidiyyatı şöbələrin rəhbərləri.",
          "Məlumatlandırılan şöbələrin rəhbərləri — yalnız baxış üçün.",
          "Sənəd üzrə tapşırıq alan şəxs və rəhbərin tapşırığı həvalə etdiyi əməkdaş.",
          "Sənəddən yaradılmış sorğunun icraçısı, onu yaradan və sorğunun getdiyi şöbənin rəhbəri.",
        ] },
        { note: "Şöbələrin sıravi əməkdaşları sənədləri görmür." },
      ] },
      { audience: "all", title: "Statuslar", blocks: [
        { list: [
          "Rəhbərin baxışında — sənəd qeydə alınıb, rəhbər hələ baxmayıb.",
          "Rəhbər tanış olub — rəhbər “Tanış oldum” basıb, tapşırıq verməyib.",
          "İcradadır — şöbə(lər) tapşırığı icra edir (bir neçə şöbədə: “İcradadır (1/2 şöbə)”).",
          "İcra olundu — bütün tapşırıqlar təsdiqlənib.",
          "Bağlandı — rəhbər son təsdiqi verib.",
        ] },
      ] },
      { audience: "registrar", title: "Sənədin qeydiyyatı", blocks: [
        { steps: [
          "“Yeni sənəd” basın. Bir neçə firmada qeydiyyat aparırsınızsa, firmanı seçin.",
          "Göndərənin VÖEN-ini yazın: təşkilat müştəri siyahısındadırsa, adı və telefonu kartdan avtomatik gəlir. Siyahıda yoxdursa, elə oradaca müştəri kartını yaradın. Dövlət qurumu üçün VÖEN boş qala bilər — onda adı əl ilə yazılır.",
          "Göndərənin sənəd nömrəsini və tarixini, sənədin tipini, daxil olma yolunu, qısa məzmunu, vərəq və nüsxə sayını yazın.",
          "Aidiyyatı şöbə(lər)i seçin. Sənədin tipinin şablonunda şöbələr göstərilibsə, onlar avtomatik yazılır və dəyişdirilmir.",
          "İstəsəniz, “Məlumatlandırılan şöbə(lər)” seçin — onların rəhbərləri sənədi yalnız görür.",
          "Skanı elə burada və ya sonra cədvəldən yükləyin, “Qeydə al” basın.",
        ] },
        { list: [
          "Daxil olma No avtomatik verilir (firma üzrə ardıcıl); onu yalnız admin dəyişə bilər.",
          "Skan şablondakı qaydaya görə adlandırılıb şablonun papkasına yazılır; şablon və ya papka yoxdursa, sistemdə saxlanılır.",
          "Şöbələrdən biri təsdiq verəndən sonra sənədi dəyişmək və silmək yalnız adminə qalır. Tapşırıq və ya sorğusu olan sənədi də yalnız admin silir.",
          "Hüquqlarınız Giriş icazələrindən gəlir: Baxış, Əlavə et (qeydiyyat və skanı olmayana skan yükləmək), Dəyişiklik et, Sil.",
        ] },
      ] },
      { audience: "director", title: "Rəhbərin baxışı və dərkənar", blocks: [
        { steps: [
          "“Rəhbərin baxışında” tabında sizə düşən sənədlər görünür (menyuda sayğac da olur).",
          "Tapşırıq lazım deyilsə, “Tanış oldum” basın (qeyd istəyə bağlıdır).",
          "Tapşırıq lazımdırsa, “Tapşırıq ver”: şöbə(lər)i və/və ya birbaşa işçi(lər)i seçin, icra müddətini və dərkənarı (göstərişi) yazın. Şöbəyə verilən tapşırıq şöbənin rəisinə gedir — rəisi təyin edilməyən şöbə seçilə bilməz.",
          "Heç kim icraya başlamayıbsa, “Tapşırıqları dəyiş” ilə alıcıları dəyişmək olar.",
        ] },
      ] },
      { audience: "head", title: "Şöbədə icra", blocks: [
        { list: [
          "Rəhbərin tapşırığı sizin Tapşırıqlar siyahınıza düşür; işi şöbə daxilində əməkdaşa həvalə edə bilərsiniz — o da sənədi görür.",
          "Başqa şöbədən nəsə lazımdırsa, sənədin sətrindən “Sorğu yarat”: şöbəni, nə lazım olduğunu və arzu olunan müddəti yazın. Sorğu sənədə bağlanır, qarşı şöbə skanı sorğudan aça bilir.",
        ] },
      ] },
      { audience: "head", title: "Təsdiq (iki səviyyə)", blocks: [
        { steps: [
          "Rəhbər sənədə baxandan (və ya tapşırıq verəndən) sonra aidiyyatı və tapşırıq alan şöbələrin rəhbərləri “Təsdiq et” verir. Şöbədə bu sənəd üzrə tapşırıq hələ bağlanmayıbsa, təsdiq vermək olmur.",
          "Bütün şöbələr təsdiqləyəndən sonra (və ya gözləmədən) firmanın rəhbəri “Son təsdiq” verir — sənəd “Bağlandı” olur.",
          "Rəhbər səbəbini yazaraq “Geri qaytar” edə bilər — şöbələr yenidən təsdiqləməli olur.",
        ] },
        { note: "Məlumatlandırılan şöbələr təsdiq vermir. “Təsdiqimi gözləyir” tabında sizdən təsdiq gözləyən sənədlər görünür." },
      ] },
    ],
  },
  {
    id: "outgoing", group: "Sənədlər", title: "Çıxan sənədlər", path: "Sənədlər → Çıxan sənədlər", section: "documents.outgoing", registrarKey: "documents.outgoing",
    intro: "Firmanın göndərdiyi sənədlərin (müqavilə, akt, məktub və s.) qeydiyyatı, yazılmış və imzalı nüsxələrin papkada saxlanması, imzalı nüsxənin qaytarılma müddətinin izlənməsi və iki səviyyəli təsdiq.",
    parts: [
      { audience: "all", title: "Sənədi kim görür (kommersiya sirri)", blocks: [
        { list: [
          "Admin və firmanın rəhbəri (direktor) — firmanın bütün sənədlərini.",
          "Qeydiyyatçı (“Çıxan sənədlər” icazəsi olan) — öz firmalarının sənədlərini.",
          "Əlaqəli (aidiyyatı) şöbələrin rəhbərləri.",
          "Məlumatlandırılan şöbələrin rəhbərləri — yalnız baxış üçün.",
          "Sənədi götürən məsul şəxs — öz sənədlərini.",
        ] },
        { note: "Şöbələrin sıravi əməkdaşları sənədləri görmür." },
      ] },
      { audience: "all", title: "Nömrələr və qaytarılma müddəti", blocks: [
        { list: [
          "Çıxış No — firma üzrə vahid, kəsilməz ardıcıllıqdır (tipdən asılı deyil).",
          "Sənədin Nömrəsi — firma və sənəd tipi üzrə ayrıca, hər il 1-dən başlayır: 001/2026.",
          "İmzalı nüsxəsi geri qaytarılan sənədin (şablonda “Bəli”) qaytarılma tarixi çıxış tarixi + şablondakı gün sayıdır; qeydiyyatçı onu dəyişə bilər.",
          "Cədvəldə: “N gün qalıb”, “Yubanır — N gün”, “✓ Qaytarılıb”. “Yubananlar” tabında gecikənlər şöbə və məsul üzrə süzülür; Sənədlər icmalında “Yubanan sənədlər” kartı var.",
          "İmzalı nüsxə yüklənəndə ona Daxil olma No və tarixi avtomatik verilir (Çıxan sənədlərin öz ardıcıllığı).",
        ] },
      ] },
      { audience: "all", title: "Məsul şəxs", blocks: [
        { p: "“Sənədi götürən şəxs (məsul)” sənədi aparan və imzalı nüsxənin vaxtında qayıtmasına cavabdeh olan əməkdaşdır. O, sənədin əlaqəli şöbələrinin əməkdaşlarından seçilir və bu sənədi öz siyahısında görür." },
      ] },
      { audience: "registrar", title: "Sənədin qeydiyyatı", blocks: [
        { steps: [
          "“Yeni sənəd” basın (bir neçə firmanız varsa, firmanı seçin).",
          "Sənədin tipini seçin — siyahıda yalnız həmin firmanın “Çıxan sənəd” şablonları olur. Şablonun faylları “Şablondan istifadə et” panelində yüklənir.",
          "Əlaqəli şöbə(lər): şablonda göstərilibsə, avtomatik yazılır və dəyişdirilmir; yoxdursa, özünüz seçin (birinci seçilən — əsas şöbə, papka və fayl adındakı {Şöbə}).",
          "İstəsəniz, “Məlumatlandırılan şöbə(lər)” seçin.",
          "VÖEN-i yazın — təşkilatın adı və telefonu müştəri kartından gəlir (VÖEN müştəri siyahısında olmalıdır).",
          "Göndərilmə şəklini, nüsxə sayını, sənədin tarixini, məsul şəxsi seçin. “İmzalı nüsxə geri qaytarılır” şablondan gəlir, bu sənəd üçün dəyişmək olar.",
          "İstəsəniz, yazılmış sənədi (Word) elə burada yükləyin və “Əlavə et” basın.",
        ] },
        { list: [
          "İlkin sənəd (Word) və Hazır sənəd (imzalı və ya sürəti) şablondakı ad qaydası ilə adlandırılıb şablonun papkalarına yazılır; papka yoxdursa, sistemdə saxlanılır. İkisi eyni adı daşıyır.",
          "Fayl papkada əl ilə köçürülüb və ya silinibsə, cədvəldə “Fayl papkada tapılmadı” görünür.",
          "Şöbələrdən biri təsdiq verəndən sonra sənədi dəyişmək və silmək yalnız adminə qalır; hazır (imzalı) sənədi yüklənmiş sənədi də yalnız admin silir.",
        ] },
      ] },
      { audience: "head", title: "Təsdiq (iki səviyyə)", blocks: [
        { steps: [
          "Hazır sənəd (imzalı nüsxə və ya qaytarılmayan sənədin sürəti) yüklənəndən sonra əlaqəli şöbələrin rəhbərləri “Təsdiq et” verir.",
          "Sonra firmanın rəhbəri “Son təsdiq” verir; səbəb yazaraq “Geri qaytar” da edə bilər — şöbələr yenidən təsdiqləyir.",
        ] },
        { note: "Məlumatlandırılan şöbələr təsdiq vermir. “Təsdiqimi gözləyir” tabında sizdən gözlənilənlər görünür." },
      ] },
    ],
  },
  {
    id: "templates", group: "Sənədlər", title: "Şablonlar", path: "Sənədlər → Şablonlar", section: "documents.templates",
    intro: "Sənəd tipləri və onların qaydaları. Hər şablon bir firmaya və bir qrupa aiddir: Çıxan sənəd, Daxil olan sənəd, Kadrlar (Digər əmrlər).",
    parts: [
      { audience: "admin", title: "Şablonun yaradılması", blocks: [
        { steps: [
          "Yuxarıda firmanı və qrup tabını seçin, “Yeni sənəd” basın.",
          "Adı yazın — eyni firmanın eyni qrupunda ad təkrarlanmır (başqa firmada və ya qrupda eyni ad ola bilər).",
          "Çıxan sənəd: aidiyyatı şöbələr, “İmzalı nüsxə geri qaytarılır” və qaytarılma müddəti, şablon faylları (3 versiya), ilkin və hazır sənəd papkaları, ad qaydası.",
          "Daxil olan sənəd: aidiyyatı şöbələr, skanın papkası və ad qaydası.",
          "Kadrlar: Word (.docx) faylı — əmrin mətni ondan oxunur; yer tutucular formada göstərilir.",
        ] },
        { list: [
          "Aidiyyatı şöbələr firmanın strukturundan seçilir; birinci — əsas şöbə. Göstərilibsə, bu tipli sənəd qeydə alınanda şöbələr avtomatik yazılır və qeydiyyatçı dəyişə bilmir.",
          "Papka yolu “İcazə verilən kök papka”nın içində olmalıdır; dəyişənlər: {ÇıxışNo}, {DaxilOlmaNo}, {SənədNo}, {SənədTipi}, {Təşkilat}, {VÖEN}, {Firma}, {Şöbə}, {Tarix}, {İl}, {Ay}.",
          "“Kopyala” şablonu faylları, papkaları və qaydaları ilə başqa firmaya və ya qrupa köçürür. Hədəf firmada olmayan şöbələr köçmür — bu barədə xəbər verilir.",
          "“✕ Faylı sil” yanlış seçilmiş faylı “Yadda saxla” ilə silir (fayl başqa şablonda istifadə olunmursa, yaddaşdan da).",
        ] },
      ] },
    ],
  },
];

const blockText = (b: Block) => ("p" in b ? b.p : "note" in b ? b.note : "steps" in b ? b.steps.join(" ") : "list" in b ? b.list.join(" ") : b.qa.flat().join(" "));

export function GuidesPage({ ctx }: { ctx: GuideContext }) {
  // Whether the viewer heads a department or directs a firm comes from the server (the firm structure).
  const [roles, setRoles] = useState({ head: false, director: false });
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/guides${ctx.viewEmployeeId ? `?employeeId=${ctx.viewEmployeeId}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((body) => {
      if (!cancelled && body) setRoles({ head: Boolean(body.head), director: Boolean(body.director) });
    });
    return () => { cancelled = true; };
  }, [ctx.viewEmployeeId]);
  const sees = (audience: Audience, guide: Guide) => ctx.isAdmin || audience === "all"
    || (audience === "registrar" && Boolean(guide.registrarKey && ctx.rights[guide.registrarKey]))
    || (audience === "head" && (roles.head || roles.director)) || (audience === "director" && roles.director);
  const available = GUIDES.filter((g) => ctx.isAdmin || ctx.sections[g.section])
    .map((g) => ({ ...g, parts: g.parts.filter((p) => sees(p.audience, g)) })).filter((g) => g.parts.length);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>(() => { try { return window.localStorage.getItem("guides:selected") || ""; } catch { return ""; } });
  const q = query.trim().toLocaleLowerCase("az");
  const matches = (g: Guide) => !q || [g.title, g.intro, ...g.parts.flatMap((p) => [p.title, ...p.blocks.map(blockText)])].join(" ").toLocaleLowerCase("az").includes(q);
  const shown = available.filter(matches);
  const current = shown.find((g) => g.id === selected) || shown[0];
  const pick = (id: string) => { setSelected(id); try { window.localStorage.setItem("guides:selected", id); } catch { /* not stored */ } };
  const groups = [...new Set(shown.map((g) => g.group))];
  return <section className="panel pagepanel guidespage">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Təlimatlar</h2><p>Bölmələrin işləmə qaydaları — sizə aid olan hissələr göstərilir</p></div>
      {current && <button type="button" className="guideprint" onClick={() => window.print()}><Printer />Çap et / PDF</button>}</div>
    {!available.length ? <p className="guideempty">Sizə açıq olan bölmələr üçün hələ təlimat yazılmayıb.</p> : <div className="guideslayout">
      <aside className="guidesnav">
        <label className="guidesearch"><Search /><Input value={query} placeholder="Təlimatlarda axtar..." onChange={(e) => setQuery(e.target.value)} /></label>
        {!shown.length && <small className="guideempty">Axtarışa uyğun təlimat tapılmadı.</small>}
        {groups.map((group) => <Fragment key={group}><b className="guidegroup">{group}</b>
          {shown.filter((g) => g.group === group).map((g) => <button type="button" key={g.id} className={current?.id === g.id ? "on" : ""} onClick={() => pick(g.id)}>{g.title}</button>)}</Fragment>)}
        <small className="guidesoon">Digər bölmələrin təlimatları növbəti versiyalarda əlavə olunacaq.</small>
      </aside>
      {current && <article className="guidearticle">
        <h3>{current.title}</h3>
        <p className="guidepath">Menyu: {current.path}</p>
        <p className="guideintro">{current.intro}</p>
        {current.parts.map((part, n) => <div className={`guidepart ${part.audience}`} key={n}>
          <h4>{part.title}{part.audience !== "all" && <em>{AUDIENCE_LABELS[part.audience]}</em>}</h4>
          {part.blocks.map((b, i) => "p" in b ? <p key={i}>{b.p}</p>
            : "note" in b ? <p key={i} className="guidenote">{b.note}</p>
            : "steps" in b ? <ol key={i}>{b.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
            : "list" in b ? <ul key={i}>{b.list.map((s, k) => <li key={k}>{s}</li>)}</ul>
            : <dl key={i}>{b.qa.map(([question, answer], k) => <Fragment key={k}><dt>{question}</dt><dd>{answer}</dd></Fragment>)}</dl>)}
        </div>)}
      </article>}
    </div>}
  </section>;
}
